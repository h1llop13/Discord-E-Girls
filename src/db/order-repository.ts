import type { Pool } from "pg";
import { normalizeCode } from "../codes/generator.js";

export interface OrderRecord {
  id: number;
  guildId: string;
  buyerDiscordId: string;
  voiceChannelId: string | null;
  status: "active" | "not_started" | "completed" | "closed";
  createdAt: Date;
  startedAt: Date | null;
  closedAt: Date | null;
}

export type ActivationResult =
  | { kind: "activated"; order: OrderRecord }
  | { kind: "used" | "missing" };

interface OrderRow {
  id: string;
  guild_id: string;
  buyer_discord_id: string;
  voice_channel_id: string | null;
  status: OrderRecord["status"];
  created_at: Date;
  started_at: Date | null;
  closed_at: Date | null;
}

function mapOrder(row: OrderRow): OrderRecord {
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    buyerDiscordId: row.buyer_discord_id,
    voiceChannelId: row.voice_channel_id,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    closedAt: row.closed_at,
  };
}

const orderColumns = `
  id, guild_id, buyer_discord_id, voice_channel_id,
  status, created_at, started_at, closed_at
`;

export class OrderRepository {
  public constructor(private readonly pool: Pool) {}

  public async activateCode(code: string, guildId: string, buyerDiscordId: string): Promise<ActivationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query<{ id: string }>(
        `UPDATE purchase_codes
         SET used_at = NOW(), used_by_discord_id = $2
         WHERE code = $1 AND used_at IS NULL
         RETURNING id`,
        [normalizeCode(code), buyerDiscordId],
      );
      const codeRow = consumed.rows[0];

      if (!codeRow) {
        const existing = await client.query<{ used_at: Date | null }>(
          "SELECT used_at FROM purchase_codes WHERE code = $1",
          [normalizeCode(code)],
        );
        await client.query("ROLLBACK");
        return { kind: existing.rows[0] ? "used" : "missing" };
      }

      const created = await client.query<OrderRow>(
        `INSERT INTO orders(code_id, guild_id, buyer_discord_id)
         VALUES ($1, $2, $3)
         RETURNING ${orderColumns}`,
        [codeRow.id, guildId, buyerDiscordId],
      );
      await client.query("COMMIT");
      const order = created.rows[0];
      if (!order) throw new Error("Order insert did not return a row.");
      return { kind: "activated", order: mapOrder(order) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async replaceVoiceChannel(orderId: number, expectedChannelId: string | null, channelId: string): Promise<string> {
    const updated = await this.pool.query<{ voice_channel_id: string }>(
      `UPDATE orders SET voice_channel_id = $2
       WHERE id = $1 AND voice_channel_id IS NOT DISTINCT FROM $3 AND status = 'active'
       RETURNING voice_channel_id`,
      [orderId, channelId, expectedChannelId],
    );
    if (updated.rows[0]) return updated.rows[0].voice_channel_id;

    const existing = await this.pool.query<{ voice_channel_id: string | null }>(
      "SELECT voice_channel_id FROM orders WHERE id = $1",
      [orderId],
    );
    const existingChannel = existing.rows[0]?.voice_channel_id;
    if (!existingChannel) throw new Error(`Order ${orderId} is not active or does not exist.`);
    return existingChannel;
  }

  public async findActive(guildId: string): Promise<OrderRecord[]> {
    const result = await this.pool.query<OrderRow>(
      `SELECT ${orderColumns} FROM orders
       WHERE guild_id = $1 AND status = 'active'
       ORDER BY id`,
      [guildId],
    );
    return result.rows.map(mapOrder);
  }

  public async findById(orderId: number): Promise<OrderRecord | null> {
    const result = await this.pool.query<OrderRow>(
      `SELECT ${orderColumns} FROM orders WHERE id = $1`,
      [orderId],
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }
}
