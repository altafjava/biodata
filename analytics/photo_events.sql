CREATE TABLE IF NOT EXISTS photo_events (
  id               BIGSERIAL     PRIMARY KEY,
  session_id       TEXT          NOT NULL,
  visited_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  photo_name       TEXT          NOT NULL,
  photo_index      INTEGER,
  event_type       TEXT          NOT NULL,
  duration_seconds INTEGER       DEFAULT 0,
  recipient_tag    TEXT          DEFAULT NULL,
  device_type      TEXT,
  ipv4             TEXT
);

ALTER TABLE photo_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_insert_photo" ON photo_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_photo" ON photo_events FOR SELECT TO anon USING (true);

CREATE INDEX idx_photo_events_visited_at ON photo_events (visited_at DESC);
CREATE INDEX idx_photo_events_session_id ON photo_events (session_id);
CREATE INDEX idx_photo_events_photo_name ON photo_events (photo_name);
CREATE INDEX idx_photo_events_event_type ON photo_events (event_type);
