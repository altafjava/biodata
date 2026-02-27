-- ============================================================
--  Supabase Setup SQL v2
--  Run this in: Supabase Dashboard → SQL Editor → New query
--  NOTE: If you already ran v1, run the ALTER TABLE section only
-- ============================================================

-- ── 1. Drop old table and recreate (ONLY if starting fresh) ──
-- Skip this if you already have data — use ALTER TABLE below instead
DROP TABLE IF EXISTS visits;

CREATE TABLE visits (
  id                BIGSERIAL PRIMARY KEY,
  session_id        TEXT,
  visited_at        TIMESTAMPTZ DEFAULT NOW(),

  -- IP (split into v4 and v6)
  ipv4              TEXT,
  ipv6              TEXT,

  -- Geo from IP API
  city              TEXT,
  region            TEXT,
  country           TEXT,
  isp               TEXT,
  latitude          FLOAT,
  longitude         FLOAT,
  timezone          TEXT,

  -- GPS (from browser permission)
  gps_granted       BOOLEAN DEFAULT FALSE,
  gps_lat           FLOAT,
  gps_lng           FLOAT,
  gps_accuracy      FLOAT,

  -- Device info
  device_type       TEXT,
  os                TEXT,
  browser           TEXT,
  screen_resolution TEXT,
  language          TEXT,
  page_url          TEXT,

  -- Engagement
  referrer          TEXT,
  duration_seconds  INTEGER DEFAULT 0,
  scroll_depth_pct  INTEGER DEFAULT 0,

  -- Source: 'whatsapp' | 'phone' | 'none'
  source            TEXT DEFAULT 'none'
);

-- ── 2. RLS Policies ───────────────────────────────────────────
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert"
  ON visits FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anonymous select"
  ON visits FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anonymous update"
  ON visits FOR UPDATE TO anon USING (true);

-- ── 3. Indexes ────────────────────────────────────────────────
CREATE INDEX idx_visits_visited_at ON visits (visited_at DESC);
CREATE INDEX idx_visits_session_id ON visits (session_id);
