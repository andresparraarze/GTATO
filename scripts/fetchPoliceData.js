/**
 * GTATO — Toronto Crime Data Ingestion (CKAN API)
 *
 * Downloads crime datasets from the City of Toronto Open Data CKAN portal,
 * filters to last 90 days, and inserts into Supabase.
 *
 * Datasets:
 *   1. Major Crime Indicators — REQUIRED
 *   2. Shootings & Firearm Discharges — OPTIONAL (continues if this fails)
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

// ── CKAN API Endpoints ───────────────────────────────────
const CKAN_BASE = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search';

const MCI_RESOURCE_ID = '0f6fe7db-81a8-4ecc-9c20-3e4e3d0c73bb';
const SHOOTINGS_RESOURCE_ID = '0b6d13fd-b07c-4440-93ea-f3e08a9498ab';

const MCI_PAGE_SIZE = 2000;
const SHOOTINGS_PAGE_SIZE = 1000;

// ── Date Filter Config ────────────────────────────────────
const DAYS_BACK = 90;
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - DAYS_BACK);
const cutoffMs = cutoffDate.getTime();

// Timestamp for this ingestion run
const NOW_ISO = new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────

/**
 * Fetch all records from a CKAN datastore_search endpoint, auto-paginating.
 * If `required` is true the script exits on failure; otherwise it logs a
 * warning and returns an empty array so the other dataset can still run.
 */
async function fetchCKAN(resourceId, label, pageSize, required = true) {
    console.log(`📡 Downloading ${label}...`);

    const allRecords = [];
    let offset = 0;

    try {
        while (true) {
            const url = `${CKAN_BASE}?resource_id=${resourceId}&limit=${pageSize}&offset=${offset}&sort=OCC_DATE desc`;
            console.log(`   Fetching offset=${offset} limit=${pageSize}...`);

            const res = await fetch(url);
            if (!res.ok) {
                const msg = `${label} download failed: HTTP ${res.status} ${res.statusText}`;
                if (required) { console.error(`❌ ${msg}`); process.exit(1); }
                console.warn(`⚠️  ${msg} — skipping this dataset`);
                return allRecords; // return whatever we have so far
            }

            const json = await res.json();

            if (!json.success || !json.result || !Array.isArray(json.result.records)) {
                const msg = `${label}: unexpected CKAN response (no result.records array)`;
                if (required) { console.error(`❌ ${msg}`); process.exit(1); }
                console.warn(`⚠️  ${msg} — skipping this dataset`);
                return allRecords;
            }

            const records = json.result.records;
            allRecords.push(...records);

            // If we got fewer records than the page size, we've reached the end
            if (records.length < pageSize) break;

            // Check if we've fetched all available records
            const total = json.result.total;
            if (total != null && allRecords.length >= total) break;

            offset += pageSize;
        }

        console.log(`   ✓ Downloaded ${allRecords.length} total records`);
        return allRecords;
    } catch (err) {
        const msg = `${label} fetch error: ${err.message}`;
        if (required) { console.error(`❌ ${msg}`); process.exit(1); }
        console.warn(`⚠️  ${msg} — skipping this dataset`);
        return allRecords;
    }
}

/**
 * Parse a date string from CKAN and return epoch ms, or null.
 */
function parseDate(raw) {
    if (!raw) return null;
    if (typeof raw === 'number') return raw;
    const parsed = new Date(raw).getTime();
    return isNaN(parsed) ? null : parsed;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log('\n🚔 GTATO — Toronto Crime Data Ingestion (CKAN API)');
    console.log(`📅 Filtering to last ${DAYS_BACK} days (since ${cutoffDate.toISOString().split('T')[0]})\n`);

    // 1. Download both datasets
    //    MCI is required — script exits if it fails.
    //    Shootings is optional — script continues with just MCI data if shootings fails.
    const mciRecords = await fetchCKAN(MCI_RESOURCE_ID, 'Major Crime Indicators', MCI_PAGE_SIZE, true);
    const shootRecords = await fetchCKAN(SHOOTINGS_RESOURCE_ID, 'Shootings & Firearm Discharges', SHOOTINGS_PAGE_SIZE, false);

    // 2. Transform + filter MCI records (last 90 days)
    const mciRows = [];
    let mciSkippedDate = 0;
    let mciSkippedCoords = 0;

    for (const rec of mciRecords) {
        const dateMs = parseDate(rec.OCC_DATE);
        if (dateMs == null || dateMs < cutoffMs) { mciSkippedDate++; continue; }

        const lat = parseFloat(rec.LAT);
        const lng = parseFloat(rec.LONG);
        if (!lat || !lng || !isFinite(lat) || !isFinite(lng)) { mciSkippedCoords++; continue; }

        mciRows.push({
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
    console.log(`\n📊 MCI: ${mciRows.length} kept, ${mciSkippedDate} outside date range, ${mciSkippedCoords} missing coords`);

    // 3. Transform + filter Shooting records (last 90 days)
    const shootRows = [];
    let shootSkippedDate = 0;
    let shootSkippedCoords = 0;

    for (const rec of shootRecords) {
        const dateMs = parseDate(rec.OCC_DATE);
        if (dateMs == null || dateMs < cutoffMs) { shootSkippedDate++; continue; }

        const lat = parseFloat(rec.LAT);
        const lng = parseFloat(rec.LONG);
        if (!lat || !lng || !isFinite(lat) || !isFinite(lng)) { shootSkippedCoords++; continue; }

        shootRows.push({
            crime_type: 'Shooting',
            lat,
            lng,
            date_reported: new Date(dateMs).toISOString(),
            neighbourhood: rec.NEIGHBOURHOOD_158 || null,
            address: rec.LOCATION_TYPE || null,
            description: rec.INJURIES != null
                ? `Firearm discharge — ${rec.INJURIES} injury(ies)`
                : 'Firearm discharge',
            source_url: 'https://open.toronto.ca',
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
    if (shootRecords.length === 0 && shootRows.length === 0) {
        console.log('\n⚠️  Note: Shootings dataset was unavailable — only MCI data was ingested.');
    }
    console.log('');
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
