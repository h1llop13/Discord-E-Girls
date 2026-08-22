import type { Pool } from "pg";

export interface GuardState {
  failedAttempts: number;
  blockedUntil: Date | null;
}

export class ActivationGuardRepository {
  public constructor(private readonly pool: Pool) {}

  public async get(guildId: string, userId: string): Promise<GuardState> {
    const result = await this.pool.query<{ failed_attempts: number; blocked_until: Date | null }>(
      `SELECT failed_attempts, blocked_until
       FROM activation_guards WHERE guild_id = $1 AND discord_user_id = $2`,
      [guildId, userId],
    );
    const row = result.rows[0];
    return row
      ? { failedAttempts: row.failed_attempts, blockedUntil: row.blocked_until }
      : { failedAttempts: 0, blockedUntil: null };
  }

  public async recordFailure(guildId: string, userId: string): Promise<GuardState> {
    const result = await this.pool.query<{ failed_attempts: number; blocked_until: Date | null }>(
      `INSERT INTO activation_guards(guild_id, discord_user_id, failed_attempts, window_started_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
         failed_attempts = CASE
           WHEN activation_guards.window_started_at <= NOW() - INTERVAL '10 minutes' THEN 1
           ELSE activation_guards.failed_attempts + 1
         END,
         window_started_at = CASE
           WHEN activation_guards.window_started_at <= NOW() - INTERVAL '10 minutes' THEN NOW()
           ELSE activation_guards.window_started_at
         END,
         blocked_until = CASE
           WHEN activation_guards.blocked_until > NOW() THEN activation_guards.blocked_until
           WHEN activation_guards.window_started_at > NOW() - INTERVAL '10 minutes'
             AND activation_guards.failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '1 hour'
           ELSE NULL
         END
       RETURNING failed_attempts, blocked_until`,
      [guildId, userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Activation guard update did not return a row.");
    return { failedAttempts: row.failed_attempts, blockedUntil: row.blocked_until };
  }

  public async clear(guildId: string, userId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM activation_guards WHERE guild_id = $1 AND discord_user_id = $2",
      [guildId, userId],
    );
  }
}
