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

-- ============================================================
--  photo_events migration — add visit_id column
--  Run in: Supabase Dashboard → SQL Editor → New query
--
--  BACKWARD COMPATIBLE — existing rows keep visit_id = NULL.
--  New rows written by biodata.js v2 will include the real
--  visit_id, enabling precise per-visit gallery joins.
-- ============================================================

-- Add visit_id column (nullable — old rows stay NULL)
ALTER TABLE photo_events
  ADD COLUMN IF NOT EXISTS visit_id BIGINT DEFAULT NULL;

-- Optional index for joining photo_events to visits
CREATE INDEX IF NOT EXISTS idx_photo_events_visit_id
  ON photo_events (visit_id)
  WHERE visit_id IS NOT NULL;


-- ============================================================
--  Migration: add zoom_pct to photo_events
--  Run in: Supabase Dashboard → SQL Editor → New query
--
--  zoom_pct stores the maximum zoom percentage reached
--  during a photo view session, sent with view_end events.
--  Examples:
--    0   = no zoom
--    100 = zoomed to 2× (zoom factor 2.0)
--    180 = zoomed to 2.8× (double-tap level)
--    500 = zoomed to 6× (max pinch)
-- ============================================================

ALTER TABLE photo_events
  ADD COLUMN IF NOT EXISTS zoom_pct INTEGER DEFAULT 0;

-- Optional index if you want to query "who zoomed deepest"
CREATE INDEX IF NOT EXISTS idx_photo_events_zoom_pct
  ON photo_events (zoom_pct)
  WHERE zoom_pct > 0;