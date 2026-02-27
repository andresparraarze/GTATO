/**
 * GTATO — Toronto Police Data Ingestion
 *
 * Downloads full GeoJSON datasets from Toronto Police Open Data portal,
 * filters to last 90 days in JavaScript, and inserts into Supabase.
 *
 * Uses only raw fetch() — no ArcGIS SDK, no wrappers.
 *
 * Datasets:
 *   1. Major Crime Indicators Open Data (GeoJSON)
 *   2. Shootings & Firearm Discharges Open Data (GeoJSON)
 *
 * Env vars required:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Service role key (bypasses RLS)
 *
 * Usage:
 *   node scripts/fetchPoliceData.js
 *   npm run fetch-data
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── Supabase Setup ────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Missing env vars.');
    console.error('   Need: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── GeoJSON Download URLs ─────────────────────────────────
// These return full datasets as GeoJSON — no query params needed.
const MCI_GEOJSON_URL =
    'https://data.torontopolice.on.ca/datasets/TorontoPS::major-crime-indicators-open-data.geojson';

const SHOOTINGS_GEOJSON_URL =
    'https://data.torontopolice.on.ca/datasets/TorontoPS::shootings-firearm-discharges-open-data.geojson';

// ── Date Filter Config ────────────────────────────────────
const DAYS_BACK = 90;
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - DAYS_BACK);
const cutoffMs = cutoffDate.getTime();

// Timestamp for this ingestion run
const NOW_ISO = new Date().toISOString();

// ── Crime Type Mapping ────────────────────────────────────
function normalizeCrimeType(category) {
    if (!category) return 'Theft';
    const cat = category.toLowerCase();
    if (cat.includes('assault')) return 'Assault';
    if (cat.includes('robbery') || cat.includes('theft over')) return 'Theft';
    if (cat.includes('break') && cat.includes('enter')) return 'Break & Enter';
    if (cat.includes('auto theft')) return 'Auto Theft';
    if (cat.includes('shoot') || cat.includes('firearm')) return 'Shooting';
    if (cat.includes('homicide')) return 'Assault';
    return 'Theft';
}

// ── Helpers ───────────────────────────────────────────────
async function fetchGeoJSON(url, label) {
    console.log(`📡 Downloading ${label}...`);
    console.log(`   URL: ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
        console.error(`❌ ${label} download failed: HTTP ${res.status} ${res.statusText}`);
        process.exit(1);
    }

    const geojson = await res.json();

    if (!geojson.features || !Array.isArray(geojson.features)) {
        console.error(`❌ ${label}: response is not valid GeoJSON (no features array)`);
        process.exit(1);
    }

    console.log(`   ✓ Downloaded ${geojson.features.length} total features`);
    return geojson.features;
}

/**
 * Extract a date (epoch ms) from a GeoJSON feature's properties.
 * Tries common field names used by Toronto Police datasets.
 */
function extractDate(props) {
    const raw = props.OCC_DATE || props.occ_date || props.REPORT_DATE || props.report_date;
    if (!raw) return null;
    // Could be epoch ms (number) or ISO string
    if (typeof raw === 'number') return raw;
    const parsed = new Date(raw).getTime();
    return isNaN(parsed) ? null : parsed;
}

/**
 * Extract lat/lng from a GeoJSON feature.
 * GeoJSON coordinates are [longitude, latitude].
 */
function extractCoords(feature) {
    const props = feature.properties || {};
    // Prefer explicit lat/lng fields if available
    if (props.LAT_WGS84 != null && props.LONG_WGS84 != null) {
        return { lat: props.LAT_WGS84, lng: props.LONG_WGS84 };
    }
    // Fall back to GeoJSON geometry.coordinates [lng, lat]
    if (feature.geometry && feature.geometry.coordinates) {
        const [lng, lat] = feature.geometry.coordinates;
        return { lat, lng };
    }
    return null;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log('\n🚔 GTATO — Toronto Police Data Ingestion');
    console.log(`📅 Filtering to last ${DAYS_BACK} days (since ${cutoffDate.toISOString().split('T')[0]})\n`);

    // 1. Download both datasets
    const [mciFeatures, shootFeatures] = await Promise.all([
        fetchGeoJSON(MCI_GEOJSON_URL, 'Major Crime Indicators'),
        fetchGeoJSON(SHOOTINGS_GEOJSON_URL, 'Shootings & Firearm Discharges'),
    ]);

    // 2. Transform + filter MCI features (last 90 days)
    const mciRows = [];
    let mciSkippedDate = 0;
    let mciSkippedCoords = 0;

    for (const f of mciFeatures) {
        const props = f.properties || {};
        const dateMs = extractDate(props);
        if (dateMs == null || dateMs < cutoffMs) { mciSkippedDate++; continue; }

        const coords = extractCoords(f);
        if (!coords || coords.lat === 0 || coords.lng === 0) { mciSkippedCoords++; continue; }

        mciRows.push({
            crime_type: normalizeCrimeType(props.CSI_CATEGORY || props.MCI_CATEGORY),
            lat: coords.lat,
            lng: coords.lng,
            date_reported: new Date(dateMs).toISOString(),
            neighbourhood: props.NEIGHBOURHOOD_158 || props.NEIGHBOURHOOD_140 || null,
            address: props.LOCATION_TYPE || props.PREMISES_TYPE || null,
            description: props.OFFENCE || props.CSI_CATEGORY || props.MCI_CATEGORY || null,
            source_url: 'https://data.torontopolice.on.ca',
            last_updated: NOW_ISO,
        });
    }
    console.log(`\n📊 MCI: ${mciRows.length} kept, ${mciSkippedDate} outside date range, ${mciSkippedCoords} missing coords`);

    // 3. Transform + filter Shooting features (last 90 days)
    const shootRows = [];
    let shootSkippedDate = 0;
    let shootSkippedCoords = 0;

    for (const f of shootFeatures) {
        const props = f.properties || {};
        const dateMs = extractDate(props);
        if (dateMs == null || dateMs < cutoffMs) { shootSkippedDate++; continue; }

        const coords = extractCoords(f);
        if (!coords || coords.lat === 0 || coords.lng === 0) { shootSkippedCoords++; continue; }

        shootRows.push({
            crime_type: 'Shooting',
            lat: coords.lat,
            lng: coords.lng,
            date_reported: new Date(dateMs).toISOString(),
            neighbourhood: props.NEIGHBOURHOOD_158 || props.NEIGHBOURHOOD_140 || null,
            address: props.LOCATION_TYPE || props.PREMISES_TYPE || null,
            description: props.INJURIES != null
                ? `Firearm discharge — ${props.INJURIES} injury(ies)`
                : 'Firearm discharge',
            source_url: 'https://data.torontopolice.on.ca',
            last_updated: NOW_ISO,
        });
    }
    console.log(`📊 Shootings: ${shootRows.length} kept, ${shootSkippedDate} outside date range, ${shootSkippedCoords} missing coords`);

    const allRows = [...mciRows, ...shootRows];
    console.log(`📊 Total: ${allRows.length} records to insert`);

    if (allRows.length === 0) {
        console.error('❌ No valid records to insert after filtering.');
        process.exit(1);
    }

    // 4. Clear old data
    console.log('\n🗑️  Clearing old crime data...');
    const { error: delErr } = await supabase
        .from('crimes')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
    if (delErr) {
        console.error('❌ Delete failed:', delErr.message);
        process.exit(1);
    }
    console.log('   ✓ Old data cleared');

    // 5. Insert in batches of 500
    console.log('\n📥 Inserting new data...');
    const BATCH = 500;
    let total = 0;
    for (let i = 0; i < allRows.length; i += BATCH) {
        const batch = allRows.slice(i, i + BATCH);
        const { data, error } = await supabase.from('crimes').insert(batch).select('id');
        if (error) {
            console.error(`❌ Insert failed at row ${i}:`, error.message);
            process.exit(1);
        }
        total += data.length;
        console.log(`   ✓ Batch ${Math.ceil((i + 1) / BATCH)}: ${data.length} rows`);
    }

    // 6. Summary
    const counts = {};
    allRows.forEach(r => { counts[r.crime_type] = (counts[r.crime_type] || 0) + 1; });

    console.log(`\n✅ Done — inserted ${total} crime records\n`);
    console.log('📋 Breakdown:');
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`   ${t}: ${c}`));
    console.log('');
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
