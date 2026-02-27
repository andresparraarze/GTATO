/**
 * GTATO — Toronto Police Data Ingestion
 *
 * Fetches real crime data from Toronto Police Service ArcGIS Open Data
 * and inserts it into Supabase. Uses only raw fetch() — no SDKs.
 *
 * Datasets:
 *   1. Major Crime Indicators Open Data (1000 most recent)
 *   2. Shooting and Firearm Discharges Open Data (500 most recent)
 *
 * Env vars required:
 *   SUPABASE_URL            — Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key (bypasses RLS)
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

// ── Dynamic Date Filter (last 90 days) ────────────────────
const DAYS_BACK = 90;
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - DAYS_BACK);
// ArcGIS date format: epoch milliseconds
const cutoffEpoch = cutoffDate.getTime();
const dateWhere = encodeURIComponent(`OCC_DATE >= ${cutoffEpoch}`);

console.log(`📅 Date filter: last ${DAYS_BACK} days (since ${cutoffDate.toISOString().split('T')[0]})`);

// ── ArcGIS Query URLs ─────────────────────────────────────
const BASE = 'https://services.arcgis.com/S9th0jAJ7bqgIRjw/ArcGIS/rest/services';

const MCI_QUERY_URL = `${BASE}/Major_Crime_Indicators_Open_Data/FeatureServer/0/query`
    + `?where=${dateWhere}`
    + '&outFields=EVENT_UNIQUE_ID,OCC_DATE,CSI_CATEGORY,OFFENCE,LOCATION_TYPE,PREMISES_TYPE,NEIGHBOURHOOD_158,LAT_WGS84,LONG_WGS84'
    + '&resultRecordCount=2000'
    + '&orderByFields=OCC_DATE%20DESC'
    + '&outSR=4326'
    + '&f=json';

const SHOOTINGS_QUERY_URL = `${BASE}/Shooting_and_Firearm_Discharges_Open_Data/FeatureServer/0/query`
    + `?where=${dateWhere}`
    + '&outFields=*'
    + '&resultRecordCount=1000'
    + '&orderByFields=OCC_DATE%20DESC'
    + '&outSR=4326'
    + '&f=json';

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

// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log('\n🚔 GTATO — Toronto Police Data Ingestion\n');

    // 1. Fetch Major Crime Indicators
    console.log('📡 Fetching Major Crime Indicators...');
    const mciRes = await fetch(MCI_QUERY_URL);
    if (!mciRes.ok) {
        console.error(`❌ MCI fetch failed: HTTP ${mciRes.status}`);
        process.exit(1);
    }
    const mciJson = await mciRes.json();
    if (mciJson.error) {
        console.error('❌ MCI ArcGIS error:', JSON.stringify(mciJson.error));
        process.exit(1);
    }
    const mciFeatures = mciJson.features || [];
    console.log(`   ✓ Got ${mciFeatures.length} MCI features`);

    // 2. Fetch Shootings
    console.log('📡 Fetching Shootings & Firearm Discharges...');
    const shootRes = await fetch(SHOOTINGS_QUERY_URL);
    if (!shootRes.ok) {
        console.error(`❌ Shootings fetch failed: HTTP ${shootRes.status}`);
        process.exit(1);
    }
    const shootJson = await shootRes.json();
    if (shootJson.error) {
        console.error('❌ Shootings ArcGIS error:', JSON.stringify(shootJson.error));
        process.exit(1);
    }
    const shootFeatures = shootJson.features || [];
    console.log(`   ✓ Got ${shootFeatures.length} Shooting features`);

    // 3. Transform MCI features
    const mciRows = [];
    for (const f of mciFeatures) {
        const a = f.attributes;
        const lat = a.LAT_WGS84 ?? f.geometry?.y;
        const lng = a.LONG_WGS84 ?? f.geometry?.x;
        if (lat == null || lng == null || lat === 0 || lng === 0) continue;
        mciRows.push({
            crime_type: normalizeCrimeType(a.CSI_CATEGORY),
            lat,
            lng,
            date_reported: a.OCC_DATE ? new Date(a.OCC_DATE).toISOString() : new Date().toISOString(),
            neighbourhood: a.NEIGHBOURHOOD_158 || null,
            address: a.LOCATION_TYPE || a.PREMISES_TYPE || null,
            description: a.OFFENCE || a.CSI_CATEGORY || null,
            source_url: 'https://data.torontopolice.on.ca',
            last_updated: NOW_ISO,
        });
    }

    // 4. Transform Shooting features
    const shootRows = [];
    for (const f of shootFeatures) {
        const a = f.attributes;
        const lat = a.LAT_WGS84 ?? f.geometry?.y;
        const lng = a.LONG_WGS84 ?? f.geometry?.x;
        if (lat == null || lng == null || lat === 0 || lng === 0) continue;
        shootRows.push({
            crime_type: 'Shooting',
            lat,
            lng,
            date_reported: a.OCC_DATE ? new Date(a.OCC_DATE).toISOString() : new Date().toISOString(),
            neighbourhood: a.NEIGHBOURHOOD_158 || null,
            address: a.LOCATION_TYPE || a.PREMISES_TYPE || null,
            description: a.INJURIES != null
                ? `Firearm discharge — ${a.INJURIES} injury(ies)`
                : 'Firearm discharge',
            source_url: 'https://data.torontopolice.on.ca',
            last_updated: NOW_ISO,
        });
    }

    const allRows = [...mciRows, ...shootRows];
    console.log(`\n📊 Transformed records: MCI=${mciRows.length}, Shootings=${shootRows.length}, Total=${allRows.length}`);

    if (allRows.length === 0) {
        console.error('❌ No valid records to insert.');
        process.exit(1);
    }

    // 5. Clear old data
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

    // 6. Insert in batches of 500
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

    // 7. Summary
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
