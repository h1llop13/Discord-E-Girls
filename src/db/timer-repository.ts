import type { Pool } from "pg";
import type { TimerPolicy } from "../timers/policy.js";
import type { TimerState } from "../timers/due-action.js";

export interface OrderTimerRecord extends TimerState {
  orderId: number;
  guildId: string;
  buyerDiscordId: string;
  voiceChannelId: string;
}

export interface ExtendedTimer {
  timer: OrderTimerRecord;
  wasLocked: boolean;
}

interface TimerRow {
  order_id: string;
  guild_id: string;
  buyer_discord_id: string;
  voice_channel_id: string;
  waiting_expires_at: Date;
  started_at: Date | null;
  warning_at: Date | null;
  closes_at: Date | null;
  deletes_at: Date | null;
  warning_sent_at: Date | null;
  entry_locked_at: Date | null;
}

function mapTimer(row: TimerRow): OrderTimerRecord {
  return {
    orderId: Number(row.order_id),
    guildId: row.guild_id,
    buyerDiscordId: row.buyer_discord_id,
    voiceChannelId: row.voice_channel_id,
    waitingExpiresAt: row.waiting_expires_at,
    startedAt: row.started_at,
    warningAt: row.warning_at,
    closesAt: row.closes_at,
    deletesAt: row.deletes_at,
    warningSentAt: row.warning_sent_at,
    entryLockedAt: row.entry_locked_at,
  };
}

const selectTimer = `
  SELECT t.order_id, o.guild_id, o.buyer_discord_id, o.voice_channel_id,
         t.waiting_expires_at, t.started_at, t.warning_at, t.closes_at,
         t.deletes_at, t.warning_sent_at, t.entry_locked_at
  FROM order_timers t
  JOIN orders o ON o.id = t.order_id
`;

export class TimerRepository {
  public constructor(private readonly pool: Pool) {}

  public async ensureWaiting(orderId: number, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO order_timers(order_id, waiting_expires_at)
       VALUES ($1, $2)
       ON CONFLICT (order_id) DO NOTHING`,
      [orderId, expiresAt],
    );
  }

  public async startIfWaiting(orderId: number, now: Date, policy: TimerPolicy): Promise<OrderTimerRecord | null> {
    const warningAt = new Date(now.getTime() + policy.orderMilliseconds - policy.warningBeforeMilliseconds);
    const closesAt = new Date(now.getTime() + policy.orderMilliseconds);
    const deletesAt = new Date(closesAt.getTime() + policy.deletionDelayMilliseconds);
    const updated = await this.pool.query<{ order_id: string }>(
      `WITH started AS (
         UPDATE order_timers
         SET started_at = $2, warning_at = $3, closes_at = $4, deletes_at = $5
         WHERE order_id = $1 AND started_at IS NULL AND waiting_expires_at > $2
         RETURNING order_id
       )
       UPDATE orders SET started_at = COALESCE(orders.started_at, $2)
       FROM started WHERE orders.id = started.order_id
       RETURNING started.order_id`,
      [orderId, now, warningAt, closesAt, deletesAt],
    );
    if (updated.rowCount !== 1) return null;
    return this.findByOrderId(orderId);
  }

  public async findByOrderId(orderId: number): Promise<OrderTimerRecord | null> {
    const result = await this.pool.query<TimerRow>(`${selectTimer} WHERE t.order_id = $1`, [orderId]);
    return result.rows[0] ? mapTimer(result.rows[0]) : null;
  }

  public async findActive(guildId: string): Promise<OrderTimerRecord[]> {
    const result = await this.pool.query<TimerRow>(
      `${selectTimer} WHERE o.guild_id = $1 AND o.status = 'active' AND o.voice_channel_id IS NOT NULL`,
      [guildId],
    );
    return result.rows.map(mapTimer);
  }

  public async addParticipant(orderId: number, discordUserId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO order_participants(order_id, discord_user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [orderId, discordUserId],
    );
  }

  public async participantIds(orderId: number): Promise<string[]> {
    const result = await this.pool.query<{ discord_user_id: string }>(
      "SELECT discord_user_id FROM order_participants WHERE order_id = $1 ORDER BY first_joined_at",
      [orderId],
    );
    return result.rows.map((row) => row.discord_user_id);
  }

  public async markWarningSent(orderId: number, at: Date): Promise<void> {
    await this.pool.query(
      "UPDATE order_timers SET warning_sent_at = COALESCE(warning_sent_at, $2) WHERE order_id = $1",
      [orderId, at],
    );
  }

  public async markEntryLocked(orderId: number, at: Date): Promise<void> {
    await this.pool.query(
      "UPDATE order_timers SET entry_locked_at = COALESCE(entry_locked_at, $2) WHERE order_id = $1",
      [orderId, at],
    );
  }

  public async extend(orderId: number, minutes: number): Promise<ExtendedTimer | null> {
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) {
      throw new RangeError("Extension must be an integer from 1 to 1440 minutes.");
    }
    const before = await this.findByOrderId(orderId);
    if (!before?.startedAt || !before.closesAt || !before.deletesAt) return null;

    const updated = await this.pool.query(
      `UPDATE order_timers SET
         warning_at = warning_at + ($2 * INTERVAL '1 minute'),
         closes_at = closes_at + ($2 * INTERVAL '1 minute'),
         deletes_at = deletes_at + ($2 * INTERVAL '1 minute'),
         entry_locked_at = NULL
       WHERE order_id = $1
         AND EXISTS (SELECT 1 FROM orders WHERE id = $1 AND status = 'active')`,
      [orderId, minutes],
    );
    if (updated.rowCount !== 1) return null;
    const timer = await this.findByOrderId(orderId);
    return timer ? { timer, wasLocked: before.entryLockedAt !== null } : null;
  }
}
