-- ============================================================
--  Biodata Analytics — Supabase Setup SQL v3
--  Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── DROP & RECREATE (safe — all data will be lost) ───────────
DROP TABLE IF EXISTS visits;

CREATE TABLE visits (
  -- ── Identity & Timing (most queried) ──────────────────────
  id                BIGSERIAL     PRIMARY KEY,
  session_id        TEXT          NOT NULL,
  visited_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- ── Recipient Tracking ────────────────────────────────────
  -- NULL = direct visit (no tag in URL)
  recipient_tag     TEXT          DEFAULT NULL,

  -- ── Engagement (updated frequently via PATCH) ─────────────
  duration_seconds  INTEGER       DEFAULT 0,
  scroll_depth_pct  INTEGER       DEFAULT 0,

  -- ── Contact action ────────────────────────────────────────
  -- 'whatsapp' | 'phone' | 'none'
  source            TEXT          DEFAULT 'none',

  -- ── Device Info ───────────────────────────────────────────
  device_type       TEXT,          -- 'Mobile' | 'Tablet' | 'Desktop'
  browser           TEXT,          -- 'Chrome' | 'Opera' | 'Samsung Browser' | ...
  os                TEXT,          -- 'Android' | 'iOS' | 'Windows' | ...
  screen_resolution TEXT,          -- '360x800'
  language          TEXT,          -- 'en-IN'

  -- ── IP Addresses ──────────────────────────────────────────
  ipv4              TEXT,
  ipv6              TEXT,

  -- ── Geo from IP API ───────────────────────────────────────
  city              TEXT,
  region            TEXT,
  country           TEXT,
  isp               TEXT,
  timezone          TEXT,
  latitude          FLOAT,
  longitude         FLOAT,

  -- ── GPS from browser permission ───────────────────────────
  gps_granted       BOOLEAN       DEFAULT FALSE,
  gps_lat           FLOAT,
  gps_lng           FLOAT,
  gps_accuracy      FLOAT,

  -- ── Request Metadata ──────────────────────────────────────
  referrer          TEXT,          -- 'WhatsApp' | 'Google' | 'Direct / Unknown' | ...
  page_url          TEXT
);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

-- Allow anon key to insert (track visit), select (admin reads), update (patch duration/scroll)
CREATE POLICY "anon_insert" ON visits FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select" ON visits FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update" ON visits FOR UPDATE TO anon USING (true);

-- ── Indexes ───────────────────────────────────────────────────
-- Primary query patterns in order of frequency:
--   1. Load dashboard filtered by date range
--   2. Group sessions for unique visitor counting
--   3. Filter/group tagged links in Recipients tab
CREATE INDEX idx_visits_visited_at    ON visits (visited_at DESC);
CREATE INDEX idx_visits_session_id    ON visits (session_id);
CREATE INDEX idx_visits_recipient_tag ON visits (recipient_tag) WHERE recipient_tag IS NOT NULL;
