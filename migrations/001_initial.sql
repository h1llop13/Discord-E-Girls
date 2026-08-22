CREATE TABLE purchase_codes (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(9) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  used_by_discord_id VARCHAR(20)
);

CREATE INDEX purchase_codes_unused_idx ON purchase_codes (code) WHERE used_at IS NULL;

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  code_id BIGINT NOT NULL UNIQUE REFERENCES purchase_codes(id),
  guild_id VARCHAR(20) NOT NULL,
  buyer_discord_id VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'not_started', 'completed', 'closed')),
  voice_channel_id VARCHAR(20) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE INDEX orders_active_idx ON orders (guild_id, status) WHERE status = 'active';

CREATE TABLE order_timers (
  order_id BIGINT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  waiting_expires_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  warning_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  deletes_at TIMESTAMPTZ,
  warning_sent_at TIMESTAMPTZ,
  entry_locked_at TIMESTAMPTZ
);

CREATE TABLE activation_guards (
  guild_id VARCHAR(20) NOT NULL,
  discord_user_id VARCHAR(20) NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  PRIMARY KEY (guild_id, discord_user_id)
);
