/**
 * GTATO — Real Toronto Police Data Ingestion
 *
 * Fetches crime data from Toronto Police Service ArcGIS Open Data:
 *   1. Major Crime Indicators (MCI) — 1000 most recent
 *   2. Shootings & Firearm Discharges — 500 most recent
 *
 * Clears old data and inserts fresh records into the Supabase `crimes` table.
 *
 * Usage:
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fetchPoliceData.js
 *   — or —
 *   npm run fetch-data  (with .env.local populated)
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ─── Config ──────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Missing env vars. Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── ArcGIS Endpoints ───────────────────────────────────
const MCI_URL =
    'https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/MCI_2014_to_Present/FeatureServer/0/query?where=1%3D1&outFields=*&resultRecordCount=1000&orderByFields=OCC_DATE+DESC&f=json';

const SHOOTINGS_URL =
    'https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/Shootings_and_Firearm_Discharges/FeatureServer/0/query?where=1%3D1&outFields=*&resultRecordCount=500&orderByFields=OCC_DATE+DESC&f=json';

// ─── Crime Type Normalization ───────────────────────────
const MCI_CATEGORY_MAP = {
    'Assault': 'Assault',
    'Robbery': 'Theft',
    'Break and Enter': 'Break & Enter',
    'Auto Theft': 'Auto Theft',
    'Theft Over': 'Theft',
    'Homicide': 'Assault',
    'Shooting': 'Shooting',
};

function normalizeCrimeType(mciCategory) {
    if (!mciCategory) return 'Theft';
    // Try exact match first
    if (MCI_CATEGORY_MAP[mciCategory]) return MCI_CATEGORY_MAP[mciCategory];
    // Case-insensitive fuzzy match
    const lower = mciCategory.toLowerCase();
    if (lower.includes('assault')) return 'Assault';
    if (lower.includes('robbery') || lower.includes('theft')) return 'Theft';
    if (lower.includes('break') || lower.includes('enter')) return 'Break & Enter';
    if (lower.includes('auto')) return 'Auto Theft';
    if (lower.includes('shoot') || lower.includes('firearm')) return 'Shooting';
    if (lower.includes('homicide')) return 'Assault';
    return 'Theft'; // fallback
}

// ─── Fetch & Transform ──────────────────────────────────
async function fetchArcGIS(url, label) {
    console.log(`📡 Fetching ${label}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${label}`);
    const json = await res.json();

    if (json.error) {
        throw new Error(`ArcGIS error: ${json.error.message || JSON.stringify(json.error)}`);
    }

    const features = json.features || [];
    console.log(`   ✓ Received ${features.length} features from ${label}`);
    return features;
}

function transformMCI(feature) {
    const { attributes, geometry } = feature;
    if (!geometry || geometry.x == null || geometry.y == null) return null;

    return {
        crime_type: normalizeCrimeType(attributes.MCI_CATEGORY),
        lat: geometry.y,
        lng: geometry.x,
        date_reported: attributes.OCC_DATE
            ? new Date(attributes.OCC_DATE).toISOString()
            : new Date().toISOString(),
        neighbourhood: attributes.NEIGHBOURHOOD_158 || attributes.NEIGHBOURHOOD_140 || null,
        address: attributes.LOCATION_TYPE || null,
        description: attributes.OFFENCE || attributes.MCI_CATEGORY || null,
        source_url: 'https://data.torontopolice.on.ca',
    };
}

function transformShooting(feature) {
    const { attributes, geometry } = feature;
    if (!geometry || geometry.x == null || geometry.y == null) return null;

    return {
        crime_type: 'Shooting',
        lat: geometry.y,
        lng: geometry.x,
        date_reported: attributes.OCC_DATE
            ? new Date(attributes.OCC_DATE).toISOString()
            : new Date().toISOString(),
        neighbourhood: attributes.NEIGHBOURHOOD_158 || attributes.NEIGHBOURHOOD_140 || null,
        address: attributes.LOCATION_TYPE || null,
        description: attributes.INJURIES
            ? `Firearm discharge — ${attributes.INJURIES} injury(ies)`
            : 'Firearm discharge',
        source_url: 'https://data.torontopolice.on.ca',
    };
}

// ─── Main ────────────────────────────────────────────────
async function main() {
    console.log('\n🚔 GTATO — Toronto Police Data Ingestion\n');

    // 1. Fetch from both endpoints
    const [mciFeatures, shootingFeatures] = await Promise.all([
        fetchArcGIS(MCI_URL, 'Major Crime Indicators'),
        fetchArcGIS(SHOOTINGS_URL, 'Shootings & Firearm Discharges'),
    ]);

    // 2. Transform
    const mciRows = mciFeatures.map(transformMCI).filter(Boolean);
    const shootingRows = shootingFeatures.map(transformShooting).filter(Boolean);
    const allRows = [...mciRows, ...shootingRows];

    console.log(`\n📊 Transformed ${allRows.length} total records`);
    console.log(`   MCI: ${mciRows.length}  |  Shootings: ${shootingRows.length}`);

    if (allRows.length === 0) {
        console.log('⚠️  No records to insert. Exiting.');
        process.exit(0);
    }

    // 3. Clear old data
    console.log('\n🗑️  Clearing existing crimes data...');
    const { error: deleteError } = await supabase
        .from('crimes')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all rows

    if (deleteError) {
        console.error('❌ Failed to clear old data:', deleteError.message);
        process.exit(1);
    }
    console.log('   ✓ Old data cleared');

    // 4. Insert in batches of 500
    const BATCH_SIZE = 500;
    let inserted = 0;

    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
            .from('crimes')
            .insert(batch)
            .select('id');

        if (error) {
            console.error(`❌ Batch insert failed (rows ${i}–${i + batch.length}):`, error.message);
            process.exit(1);
        }

        inserted += data.length;
        console.log(`   ✓ Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${data.length} rows`);
    }

    console.log(`\n✅ Done! Inserted ${inserted} crime records into Supabase.`);

    // Summary by type
    const typeCounts = {};
    allRows.forEach((r) => {
        typeCounts[r.crime_type] = (typeCounts[r.crime_type] || 0) + 1;
    });
    console.log('\n📋 Breakdown by crime type:');
    Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => console.log(`   ${type}: ${count}`));

    console.log('');
}

main().catch((err) => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
