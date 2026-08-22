import type { Pool } from "pg";
import { normalizeCode } from "../codes/generator.js";

export type CodeStatus = "available" | "used" | "missing";
export type ConsumeResult = "consumed" | "used" | "missing";

export class CodeRepository {
  public constructor(private readonly pool: Pool) {}

  public async insertCodes(codes: readonly string[]): Promise<string[]> {
    if (codes.length === 0) return [];

    const result = await this.pool.query<{ code: string }>(
      `INSERT INTO purchase_codes(code)
       SELECT code FROM UNNEST($1::text[]) AS code
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [codes],
    );
    return result.rows.map((row) => row.code);
  }

  public async status(code: string): Promise<CodeStatus> {
    const result = await this.pool.query<{ used_at: Date | null }>(
      "SELECT used_at FROM purchase_codes WHERE code = $1",
      [normalizeCode(code)],
    );
    const row = result.rows[0];
    if (!row) return "missing";
    return row.used_at === null ? "available" : "used";
  }

  public async consume(code: string, discordUserId: string): Promise<ConsumeResult> {
    const normalized = normalizeCode(code);
    const consumed = await this.pool.query(
      `UPDATE purchase_codes
       SET used_at = NOW(), used_by_discord_id = $2
       WHERE code = $1 AND used_at IS NULL
       RETURNING id`,
      [normalized, discordUserId],
    );

    if (consumed.rowCount === 1) return "consumed";
    const status = await this.status(normalized);
    return status === "available" ? "used" : status;
  }

  public async unusedCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM purchase_codes WHERE used_at IS NULL",
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
