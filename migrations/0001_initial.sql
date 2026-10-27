CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  avatar_url text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'moderator')),
  profile_public boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  CHECK (char_length(display_name) BETWEEN 1 AND 64),
  CHECK (char_length(bio) <= 280)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_active_lower_uq ON users (lower(username)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_lower_uq ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_public_profile_idx ON users (lower(username)) WHERE profile_public AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx ON auth_sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_verification_user_idx ON email_verification_tokens (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('direct', 'group', 'channel')),
  title text,
  username text,
  is_public boolean NOT NULL DEFAULT false,
  direct_key text UNIQUE,
  creator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'direct' AND direct_key IS NOT NULL AND title IS NULL) OR type <> 'direct'),
  CHECK ((type = 'channel' OR type = 'group') OR username IS NULL),
  CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 80),
  CHECK (username IS NULL OR username ~ '^[a-zA-Z0-9_]{3,32}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_public_username_uq ON conversations (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_public_discovery_idx ON conversations (type, lower(title)) WHERE is_public;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON conversation_members (user_id, archived, joined_at DESC);

CREATE TABLE IF NOT EXISTS bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (username ~ '^[a-zA-Z0-9_]{3,28}$'),
  CHECK (char_length(name) BETWEEN 1 AND 64),
  CHECK (char_length(description) <= 280)
);
CREATE UNIQUE INDEX IF NOT EXISTS bots_username_active_lower_uq ON bots (lower(username)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bots_owner_idx ON bots (owner_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bot_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS bot_tokens_active_idx ON bot_tokens (bot_id, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS bot_conversation_members (
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS bot_conversation_conversation_idx ON bot_conversation_members (conversation_id, bot_id);

CREATE TABLE IF NOT EXISTS messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sender_bot_id uuid REFERENCES bots(id) ON DELETE SET NULL,
  sender_name_snapshot text NOT NULL DEFAULT '',
  content text NOT NULL,
  reply_to_id bigint REFERENCES messages(id) ON DELETE SET NULL,
  client_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CHECK (NOT (sender_id IS NOT NULL AND sender_bot_id IS NOT NULL)),
  CHECK (char_length(content) <= 5000)
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_user_idempotency_uq ON messages (sender_id, conversation_id, client_request_id) WHERE sender_id IS NOT NULL AND client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_bot_idempotency_uq ON messages (sender_bot_id, conversation_id, client_request_id) WHERE sender_bot_id IS NOT NULL AND client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_conversation_cursor_idx ON messages (conversation_id, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages (sender_id, created_at DESC) WHERE sender_id IS NOT NULL;

CREATE OR REPLACE FUNCTION search_normalize(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      translate(
        translate(
          translate(lower(coalesce(input, '')), 'يىكـ', 'ییک '),
          '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
          '01234567890123456789'
        ),
        U&'\064B\064C\064D\064E\064F\0650\0651\0652\0653\0654\0655\0656\0657\0658\0659\065A\065B\065C\065D\065E\065F\0670\200C\200D',
        repeat(' ', 25)
      ),
      '[،؛؟«»…]+', ' ', 'g'
    ),
    '[[:space:][:punct:]]+', ' ', 'g'
  ))
$$;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', search_normalize(content))) STORED;
CREATE INDEX IF NOT EXISTS messages_search_vector_gin_idx ON messages USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_attachments_message_idx ON message_attachments (message_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS message_read_states (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS saved_messages (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS saved_messages_user_idx ON saved_messages (user_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS conversation_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drafts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id),
  CHECK (char_length(content) <= 5000)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id bigint REFERENCES messages(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS reports_queue_idx ON reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_recent_idx ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS bot_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  UNIQUE (bot_id, event_key)
);
CREATE INDEX IF NOT EXISTS bot_events_poll_idx ON bot_events (bot_id, id ASC);

CREATE TABLE IF NOT EXISTS bot_commands (
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  command text NOT NULL CHECK (command ~ '^[a-z0-9_]{1,32}$'),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, command)
);

CREATE TABLE IF NOT EXISTS bot_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL,
  secret_hash char(64) NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
