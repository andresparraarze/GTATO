# 🚔 GTATO — GTA Toronto Crime Map

> Real-time crime intelligence for the Greater Toronto Area

GTATO is an interactive, live-updating crime map for the Greater Toronto Area. It pulls data directly from the Toronto Police Service via the City of Toronto Open Data portal and displays incidents on a map with filtering, clustering, and user location features.

**Live app:** [gtato.vercel.app](https://gtato.vercel.app)

---

## Features

- 🗺️ **Interactive map** centered on the GTA with clustered crime pins
- 🎨 **10 crime categories** — each with a unique color and icon (Assaults, Auto Thefts, Bicycle Theft, Break and Enter, Homicide, Robbery, Sexual Violation, Shooting, Theft from MV, Theft Over)
- 📍 **User location** — detects your position, centers the map on you, and shows incidents within a selected radius
- 🔍 **Filters** — filter by crime type and date range
- 🔥 **Heatmap mode** — toggle between pin view and a crime density heatmap
- 🕐 **Data freshness badge** — shows when the data was last updated
- 📊 **Neighbourhood stats** — click any area to see a breakdown of recent incidents
- 🔄 **Auto-updated daily** — GitHub Actions cron job pulls fresh data every day at 6am UTC

---

## Data Sources

| Dataset | Source | Update Frequency |
|---|---|---|
| Major Crime Indicators (MCI) | City of Toronto Open Data | Weekly |
| Shootings & Firearm Discharges | City of Toronto Open Data | Weekly |

Data is sourced from the **City of Toronto Open Data CKAN portal** which is fed directly by the Toronto Police Service. Categories match the official TPS MCI classification system.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Map | Leaflet.js + react-leaflet |
| Database | Supabase (Postgres + PostGIS) |
| Backend | Supabase serverless API |
| Data ingestion | Node.js script via GitHub Actions |
| Deployment | Vercel |
| CI/CD | GitHub Actions |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase account and project
- A Vercel account

### 1. Clone the repo

```bash
git clone https://github.com/andresparraarze/GTATO.git
cd GTATO
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the root:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_key
```

### 4. Set up the Supabase database

Run this SQL in your Supabase SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE crimes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  crime_type text NOT NULL,
  date_reported timestamptz,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  address text,
  neighbourhood text,
  description text,
  source_url text,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE crimes ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS crimes_crime_type_idx ON crimes(crime_type);
CREATE INDEX IF NOT EXISTS crimes_date_reported_idx ON crimes(date_reported DESC);
CREATE INDEX IF NOT EXISTS crimes_location_idx ON crimes(lat, lng);

ALTER TABLE crimes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON crimes FOR SELECT USING (true);
```

### 5. Run the data ingestion script

Add your service role key to `.env.local`:

```env
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Then run:

```bash
node scripts/fetchPoliceData.js
```

### 6. Start the dev server

```bash
npm run dev
```

---

## Deployment

The app deploys automatically to Vercel on every push to `main`.

### Vercel Environment Variables

Add these in your Vercel project settings:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

### GitHub Actions Secrets

Add these for the data ingestion cron job:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The cron job runs daily at 6am UTC and pulls the latest 90 days of crime data into Supabase automatically.

---

## Project Structure

```
GTATO/
├── src/                  # React frontend
│   ├── components/       # Map, sidebar, filters, popups
│   └── lib/              # Supabase client config
├── scripts/
│   └── fetchPoliceData.js  # Data ingestion script
├── sql/                  # Database schema
├── .github/
│   └── workflows/
│       └── fetch-data.yml  # Daily cron job
├── .env.local            # Local environment variables (not committed)
└── vercel.json           # Vercel deployment config
```

## Data Disclaimer

All crime data is sourced from the Toronto Police Service via the City of Toronto Open Data portal and is provided for informational purposes only. Incident locations are approximate. GTATO is not affiliated with the Toronto Police Service or the City of Toronto.

---

## License

All rights reserved © 2026 GTATO