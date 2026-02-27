/**
 * GTATO — Toronto Crime Data Ingestion (CKAN API)
 *
 * Downloads the 5000 most recent crime records from the City of Toronto
 * Open Data CKAN portal and inserts them into Supabase.
 *
 * Strategy:
 *   1. Try the CKAN Datastore API (structured JSON, sorted by OCC_DATE desc)
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
const DATASTORE_URL =
    'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search';
const MCI_RESOURCE_ID = '11581817-b148-4dd4-99c4-679649515ccc';

// Hard limit — fetch the 5000 most recent records
const RECORD_LIMIT = 5000;

// Fallback: Direct JSON download (raw array)
const DIRECT_JSON_URL =
    'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/6909ea60-ef0e-465f-b5d0-43106b6b9130/resource/0f15c1f7-491f-44f8-b278-91c65520d6a4/download/major-crime-indicators.json';

// Timestamp for this ingestion run
const NOW_ISO = new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────

/**
 * Fetch records via the CKAN Datastore API sorted by OCC_DATE desc.
 * Single request with limit=5000 — no pagination needed.
 */
async function fetchViaDatastore() {
    console.log('📡 Trying CKAN Datastore API...');
    const url = `${DATASTORE_URL}?resource_id=${MCI_RESOURCE_ID}&limit=${RECORD_LIMIT}&sort=OCC_DATE desc`;
    console.log(`   URL: ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Datastore API returned HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();

    if (!json.success || !json.result || !Array.isArray(json.result.records)) {
        throw new Error('Unexpected Datastore API response (no result.records array)');
    }

    const records = json.result.records;
    console.log(`   ✓ Datastore API: ${records.length} records (total available: ${json.result.total ?? '?'})`);
    return records;
}

/**
 * Fetch records via the direct JSON download (fallback).
 * Slices to RECORD_LIMIT since the full file can be huge.
 */
async function fetchViaDirect() {
    console.log('📡 Trying direct JSON download (fallback)...');
    const res = await fetch(DIRECT_JSON_URL);
    if (!res.ok) {
        throw new Error(`Direct download failed: HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const records = Array.isArray(data) ? data : (data.records || data.result?.records || []);
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Direct download returned no usable records');
    }

    // Take only the most recent RECORD_LIMIT records
    const sliced = records.slice(0, RECORD_LIMIT);
    console.log(`   ✓ Direct download: ${records.length} total, using ${sliced.length}`);
    return sliced;
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
 * Try to parse any date-like value into an ISO string.
 * Returns the ISO string or null.
 */
function toISODate(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') {
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const str = String(raw).trim();
    let d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString();
    // Try replacing slashes (YYYY/MM/DD → YYYY-MM-DD)
    d = new Date(str.replace(/\//g, '-'));
    if (!isNaN(d.getTime())) return d.toISOString();
    return null;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log('\n🚔 GTATO — Toronto Crime Data Ingestion (CKAN)');
    console.log(`📦 Fetching up to ${RECORD_LIMIT} most recent records (no date filter)\n`);

    // 1. Download records
    const records = await fetchRecords();

    if (records.length === 0) {
        console.error('❌ No records returned from API.');
        process.exit(1);
    }

    // 2. Log first record so we can inspect exact field names and formats
    console.log('\n🔍 Raw field names and values of first record:');
    const first = records[0];
    for (const [key, value] of Object.entries(first)) {
        console.log(`   ${key}: ${JSON.stringify(value)} (${typeof value})`);
    }
    console.log('');

    // 3. Transform — keep records from 2024+ with valid coordinates
    const DATE_CUTOFF = '2024-01-01';
    const rows = [];
    let skippedCoords = 0;
    let skippedDate = 0;

    for (const rec of records) {
        // Date filter: OCC_DATE is a YYYY-MM-DD string
        const occDate = rec.OCC_DATE || '';
        if (occDate < DATE_CUTOFF) { skippedDate++; continue; }

        const lat = parseFloat(rec.LAT_WGS84);
        const lng = parseFloat(rec.LONG_WGS84);
        if (!lat || !lng || !isFinite(lat) || !isFinite(lng)) {
            skippedCoords++;
            continue;
        }

        const dateISO = toISODate(occDate);

        rows.push({
            crime_type: rec.CSI_CATEGORY || 'Unknown',
            city: 'toronto',
            lat,
            lng,
            date_reported: dateISO,
            neighbourhood: rec.NEIGHBOURHOOD_158 || null,
            address: rec.LOCATION_TYPE || null,
            description: rec.OFFENCE || null,
            source_url: 'https://open.toronto.ca',
            last_updated: NOW_ISO,
        });
    }

    console.log(`📊 ${rows.length} kept, ${skippedDate} before ${DATE_CUTOFF}, ${skippedCoords} missing coords`);

    if (rows.length === 0) {
        console.error('❌ Zero valid records to insert — all records had missing coordinates.');
        process.exit(1);
    }

    // 4. Clear old Toronto data (scope to city='toronto' to protect other cities)
    console.log('\n🗑️  Clearing old Toronto crime data...');
    const { error: delErr } = await supabase
        .from('crimes')
        .delete()
        .eq('city', 'toronto');
    if (delErr) {
        console.error('❌ Supabase DELETE failed:', delErr.message);
        console.error('   Details:', JSON.stringify(delErr));
        process.exit(1);
    }
    console.log('   ✓ Old Toronto data cleared');

    // 5. Insert in batches of 500
    console.log('\n📥 Inserting new data...');
    const BATCH = 500;
    let totalInserted = 0;
    let insertErrors = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { data, error } = await supabase.from('crimes').insert(batch).select('id');
        if (error) {
            console.error(`❌ Supabase INSERT failed at batch starting row ${i}:`);
            console.error(`   Message: ${error.message}`);
            console.error(`   Code: ${error.code}`);
            console.error(`   Details: ${JSON.stringify(error.details)}`);
            console.error(`   Hint: ${error.hint || 'none'}`);
            insertErrors++;
            continue; // try remaining batches instead of crashing
        }
        totalInserted += data.length;
        console.log(`   ✓ Batch ${Math.ceil((i + 1) / BATCH)}: ${data.length} rows inserted`);
    }

    // 6. Summary
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📊 RESULTS:`);
    console.log(`   Records fetched:    ${records.length}`);
    console.log(`   Skipped (no coords): ${skippedCoords}`);
    console.log(`   Attempted to insert: ${rows.length}`);
    console.log(`   Successfully inserted: ${totalInserted}`);
    console.log(`   Failed batches:     ${insertErrors}`);

    if (totalInserted > 0) {
        const counts = {};
        rows.forEach(r => { counts[r.crime_type] = (counts[r.crime_type] || 0) + 1; });
        console.log(`\n📋 Crime type breakdown:`);
        Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`   ${t}: ${c}`));
    }

    if (totalInserted === 0) {
        console.error('\n❌ FAILED: Zero records were inserted into Supabase.');
        process.exit(1);
    }

    console.log(`\n✅ Done — ${totalInserted} crime records in Supabase\n`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
