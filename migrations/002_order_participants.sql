CREATE TABLE order_participants (
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  discord_user_id VARCHAR(20) NOT NULL,
  first_joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_id, discord_user_id)
);

CREATE INDEX order_timers_due_idx ON order_timers (waiting_expires_at, closes_at, deletes_at);
CREATE INDEX orders_voice_channel_idx ON orders (voice_channel_id) WHERE voice_channel_id IS NOT NULL;
