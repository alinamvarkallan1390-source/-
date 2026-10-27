ALTER TABLE bot_events ADD COLUMN IF NOT EXISTS conversation_id uuid;

UPDATE bot_events AS be
SET conversation_id = c.id
FROM conversations AS c
WHERE be.conversation_id IS NULL
  AND be.payload->>'conversation_id' = c.id::text;

DELETE FROM bot_events WHERE conversation_id IS NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'bot_events'::regclass
      AND conname = 'bot_events_conversation_id_fkey'
  ) THEN
    ALTER TABLE bot_events
      ADD CONSTRAINT bot_events_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END
$migration$;

ALTER TABLE bot_events ALTER COLUMN conversation_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS bot_events_conversation_idx ON bot_events (bot_id, conversation_id, id ASC);
