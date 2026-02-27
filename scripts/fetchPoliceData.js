/**
 * GTATO — Toronto Crime Data Ingestion (CKAN API)
 *
 * Downloads crime data from the City of Toronto Open Data CKAN portal
 * (Community Safety Indicators / Major Crime Indicators dataset),
 * filters to last 90 days, and inserts into Supabase.
 *
 * Strategy:
 *   1. Try the CKAN Datastore API (structured JSON with pagination)
 *   2. If that fails, fall back to the direct JSON download
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

// ── CKAN Endpoints ───────────────────────────────────────
// Primary: Datastore API (paginated, structured)
const DATASTORE_URL =
    'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search';
const MCI_RESOURCE_ID = '11581817-b148-4dd4-99c4-679649515ccc';
const PAGE_SIZE = 2000;

// Fallback: Direct JSON download (raw array)
const DIRECT_JSON_URL =
    'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/6909ea60-ef0e-465f-b5d0-43106b6b9130/resource/0f15c1f7-491f-44f8-b278-91c65520d6a4/download/major-crime-indicators.json';

// ── Date Filter Config ────────────────────────────────────
const DAYS_BACK = 90;
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - DAYS_BACK);
const cutoffMs = cutoffDate.getTime();

// Timestamp for this ingestion run
const NOW_ISO = new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────

/**
 * Fetch all records via the CKAN Datastore API, auto-paginating.
 * Returns the records array, or throws on failure.
 */
async function fetchViaDatastore() {
    console.log('📡 Trying CKAN Datastore API...');
    const allRecords = [];
    let offset = 0;

    while (true) {
        const url = `${DATASTORE_URL}?resource_id=${MCI_RESOURCE_ID}&limit=${PAGE_SIZE}&offset=${offset}`;
        console.log(`   Fetching offset=${offset} limit=${PAGE_SIZE}...`);

        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Datastore API returned HTTP ${res.status} ${res.statusText}`);
        }

        const json = await res.json();

        if (!json.success || !json.result || !Array.isArray(json.result.records)) {
            throw new Error('Unexpected Datastore API response (no result.records array)');
        }

        const records = json.result.records;
        allRecords.push(...records);

        // If we got fewer records than the page size, we've reached the end
        if (records.length < PAGE_SIZE) break;

        // Check if we've fetched all available records
        const total = json.result.total;
        if (total != null && allRecords.length >= total) break;

        offset += PAGE_SIZE;
    }

    console.log(`   ✓ Datastore API: ${allRecords.length} total records`);
    return allRecords;
}

/**
 * Fetch all records via the direct JSON download (fallback).
 * The direct download returns a raw JSON array of objects.
 */
async function fetchViaDirect() {
    console.log('📡 Trying direct JSON download (fallback)...');
    const res = await fetch(DIRECT_JSON_URL);
    if (!res.ok) {
        throw new Error(`Direct download failed: HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    // Handle both array and object-with-array formats
    const records = Array.isArray(data) ? data : (data.records || data.result?.records || []);
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Direct download returned no usable records');
    }

    console.log(`   ✓ Direct download: ${records.length} total records`);
    return records;
}

/**
 * Fetch records — try Datastore API first, fall back to direct download.
 */
async function fetchRecords() {
    try {
        return await fetchViaDatastore();
    } catch (err) {
        console.warn(`⚠️  Datastore API failed: ${err.message}`);
        console.warn('   Falling back to direct JSON download...\n');
    }

    try {
        return await fetchViaDirect();
    } catch (err) {
        console.error(`❌ Direct download also failed: ${err.message}`);
        process.exit(1);
    }
}

/**
 * Parse a date string and return epoch ms, or null.
 */
function parseDate(raw) {
    if (!raw) return null;
    if (typeof raw === 'number') return raw;
    const parsed = new Date(raw).getTime();
    return isNaN(parsed) ? null : parsed;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log('\n🚔 GTATO — Toronto Crime Data Ingestion (CKAN)');
    console.log(`📅 Filtering to last ${DAYS_BACK} days (since ${cutoffDate.toISOString().split('T')[0]})\n`);

    // 1. Download records (Datastore API → direct JSON fallback)
    const records = await fetchRecords();

    // 2. Transform + filter to last 90 days
    const rows = [];
    let skippedDate = 0;
    let skippedCoords = 0;

    for (const rec of records) {
        const dateMs = parseDate(rec.OCC_DATE);
        if (dateMs == null || dateMs < cutoffMs) { skippedDate++; continue; }

        const lat = parseFloat(rec.LAT);
        const lng = parseFloat(rec.LONG);
        if (!lat || !lng || !isFinite(lat) || !isFinite(lng)) { skippedCoords++; continue; }

        rows.push({
            crime_type: rec.MCI_CATEGORY || 'Unknown',
            lat,
            lng,
            date_reported: new Date(dateMs).toISOString(),
            neighbourhood: rec.NEIGHBOURHOOD_158 || null,
            address: rec.LOCATION_TYPE || null,
            description: rec.OFFENCE || null,
            source_url: 'https://open.toronto.ca',
            last_updated: NOW_ISO,
        });
    }

    console.log(`\n📊 ${rows.length} kept, ${skippedDate} outside date range, ${skippedCoords} missing coords`);

    if (rows.length === 0) {
        console.error('❌ No valid records to insert after filtering.');
        process.exit(1);
    }

    // 3. Clear old data
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

    // 4. Insert in batches of 500
    console.log('\n📥 Inserting new data...');
    const BATCH = 500;
    let total = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { data, error } = await supabase.from('crimes').insert(batch).select('id');
        if (error) {
            console.error(`❌ Insert failed at row ${i}:`, error.message);
            process.exit(1);
        }
        total += data.length;
        console.log(`   ✓ Batch ${Math.ceil((i + 1) / BATCH)}: ${data.length} rows`);
    }

    // 5. Summary
    const counts = {};
    rows.forEach(r => { counts[r.crime_type] = (counts[r.crime_type] || 0) + 1; });

    console.log(`\n✅ Done — inserted ${total} crime records\n`);
    console.log('📋 Breakdown:');
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`   ${t}: ${c}`));
    console.log('');
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
