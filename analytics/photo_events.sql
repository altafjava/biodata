-- ============================================================
--  Gallery Analytics — photo_events table
--  Run in: Supabase Dashboard → SQL Editor → New query
--  NON-BREAKING: does NOT touch the existing visits table.
-- ============================================================

CREATE TABLE IF NOT EXISTS photo_events (
  id               BIGSERIAL     PRIMARY KEY,
  session_id       TEXT          NOT NULL,
  visited_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  photo_name       TEXT          NOT NULL,    -- filename e.g. "photo1.jpg"
  photo_index      INTEGER,                   -- 0-based position in gallery
  event_type       TEXT          NOT NULL,    -- see types below
  duration_seconds INTEGER       DEFAULT 0,
  recipient_tag    TEXT          DEFAULT NULL,
  device_type      TEXT,
  ipv4             TEXT
);

-- Event types:
--   view             → Photo slide becomes the active page
--   view_end         → User swipes away from a photo (includes duration)
--   lightbox_open    → Tap photo to open fullscreen
--   lightbox_close   → Close lightbox (includes duration inside)
--   zoom             → Pinch / double-tap / scroll-wheel zoom (once per open)
--   download_attempt → Long-press / right-click on photo

ALTER TABLE photo_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_photo" ON photo_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_photo" ON photo_events FOR SELECT TO anon USING (true);

CREATE INDEX idx_photo_events_visited_at ON photo_events (visited_at DESC);
CREATE INDEX idx_photo_events_session_id ON photo_events (session_id);
CREATE INDEX idx_photo_events_photo_name ON photo_events (photo_name);
CREATE INDEX idx_photo_events_event_type ON photo_events (event_type);
