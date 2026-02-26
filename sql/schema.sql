-- ============================================
-- GTATO Crime Map — Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Enable PostGIS extension (for future geospatial queries)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Create the crimes table
CREATE TABLE IF NOT EXISTS crimes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crime_type    TEXT NOT NULL,
  date_reported TIMESTAMPTZ NOT NULL,
  latitude      FLOAT8 NOT NULL,
  longitude     FLOAT8 NOT NULL,
  address       TEXT,
  neighbourhood TEXT,
  description   TEXT,
  source_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes for common filter queries
CREATE INDEX IF NOT EXISTS idx_crimes_crime_type    ON crimes (crime_type);
CREATE INDEX IF NOT EXISTS idx_crimes_date_reported ON crimes (date_reported);

-- 4. Enable Row Level Security (required by Supabase)
ALTER TABLE crimes ENABLE ROW LEVEL SECURITY;

-- 5. Allow public (anon) read access
CREATE POLICY "Allow public read access"
  ON crimes
  FOR SELECT
  USING (true);

-- 6. (Optional) Generated geography column for future radius queries
-- ALTER TABLE crimes ADD COLUMN geog GEOGRAPHY(Point, 4326)
--   GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED;
-- CREATE INDEX idx_crimes_geog ON crimes USING GIST (geog);
