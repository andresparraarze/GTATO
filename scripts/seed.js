/**
 * GTATO Crime Map — Sample Data Seeder
 * 
 * Inserts 20 realistic fake crime entries across the Greater Toronto Area.
 * 
 * Usage:
 *   1. Copy .env.local values into a .env file (or set env vars)
 *   2. Run: node scripts/seed.js
 * 
 * Requires: npm install dotenv @supabase/supabase-js
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment.');
    console.error('   Copy .env.local to .env or set the variables directly.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 20 realistic crime entries spread across the GTA.
 * Coordinates are real Toronto locations; incidents are fictional.
 */
const SAMPLE_CRIMES = [
    {
        crime_type: 'Assault',
        date_reported: '2025-01-15T22:30:00-05:00',
        latitude: 43.6544,
        longitude: -79.3807,
        address: '100 Queen St W',
        neighbourhood: 'Downtown Toronto',
        description: 'Aggravated assault reported outside a nightclub. Suspect fled on foot.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Theft',
        date_reported: '2025-01-18T14:15:00-05:00',
        latitude: 43.7785,
        longitude: -79.4163,
        address: '3401 Dufferin St',
        neighbourhood: 'Yorkdale',
        description: 'Shoplifting incident at Yorkdale Shopping Centre. Over $5,000 in merchandise taken.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Shooting',
        date_reported: '2025-02-02T01:45:00-05:00',
        latitude: 43.7442,
        longitude: -79.2319,
        address: '3050 Lawrence Ave E',
        neighbourhood: 'Scarborough Village',
        description: 'Shots fired from a moving vehicle. No injuries reported. Shell casings found.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Break & Enter',
        date_reported: '2025-02-05T03:20:00-05:00',
        latitude: 43.6872,
        longitude: -79.3953,
        address: '680 Bloor St W',
        neighbourhood: 'The Annex',
        description: 'Break-in at a residential unit. Entry through rear window. Electronics stolen.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Auto Theft',
        date_reported: '2025-02-10T06:00:00-05:00',
        latitude: 43.7731,
        longitude: -79.3456,
        address: '1800 Bayview Ave',
        neighbourhood: 'Leaside',
        description: 'Honda CR-V stolen from residential driveway overnight using relay attack.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Assault',
        date_reported: '2025-02-14T19:10:00-05:00',
        latitude: 43.6426,
        longitude: -79.3871,
        address: '20 Bay St',
        neighbourhood: 'Harbourfront',
        description: 'Domestic assault reported at a condo unit. Suspect apprehended on scene.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Theft',
        date_reported: '2025-02-20T11:30:00-05:00',
        latitude: 43.6563,
        longitude: -79.4103,
        address: '935 Queen St W',
        neighbourhood: 'Trinity-Bellwoods',
        description: 'Bicycle theft from a locked rack. Security camera footage under review.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Shooting',
        date_reported: '2025-03-01T23:55:00-05:00',
        latitude: 43.7615,
        longitude: -79.5200,
        address: '2700 Kipling Ave',
        neighbourhood: 'Rexdale',
        description: 'Multiple gunshots heard near apartment complex. One person treated for graze wound.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Break & Enter',
        date_reported: '2025-03-05T04:10:00-05:00',
        latitude: 43.7054,
        longitude: -79.3490,
        address: '1 Broadview Ave',
        neighbourhood: 'Broadview North',
        description: 'Commercial break-in at a retail store. Forced entry through front door.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Auto Theft',
        date_reported: '2025-03-08T02:30:00-05:00',
        latitude: 43.8052,
        longitude: -79.2753,
        address: '300 Borough Dr',
        neighbourhood: 'Scarborough Town Centre',
        description: 'Lexus RX stolen from parking garage using electronic key fob duplication.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Assault',
        date_reported: '2025-03-12T20:45:00-04:00',
        latitude: 43.6673,
        longitude: -79.4027,
        address: '400 University Ave',
        neighbourhood: 'Discovery District',
        description: 'Unprovoked assault on a pedestrian near hospital. Suspect described as male, 30s.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Theft',
        date_reported: '2025-03-15T16:20:00-04:00',
        latitude: 43.6452,
        longitude: -79.3740,
        address: '220 Yonge St',
        neighbourhood: 'Eaton Centre',
        description: 'Purse snatching inside the Eaton Centre food court. Suspect apprehended by security.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Shooting',
        date_reported: '2025-03-20T00:15:00-04:00',
        latitude: 43.7280,
        longitude: -79.4637,
        address: '1500 Jane St',
        neighbourhood: 'Jane and Finch',
        description: 'Reported shooting in parking lot. Armed suspects fled in dark-coloured sedan.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Break & Enter',
        date_reported: '2025-03-25T05:45:00-04:00',
        latitude: 43.6795,
        longitude: -79.2973,
        address: '966 Gerrard St E',
        neighbourhood: 'Leslieville',
        description: 'Break-in at a cafe. Cash register emptied. Entry through basement window.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Auto Theft',
        date_reported: '2025-04-01T07:00:00-04:00',
        latitude: 43.8361,
        longitude: -79.5081,
        address: '9191 Yonge St',
        neighbourhood: 'Richmond Hill',
        description: 'Toyota Highlander stolen from driveway. AirTag tracked to a shipping container yard.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Assault',
        date_reported: '2025-04-05T21:30:00-04:00',
        latitude: 43.6510,
        longitude: -79.3470,
        address: '55 Mill St',
        neighbourhood: 'Distillery District',
        description: 'Bar fight escalated into aggravated assault with a weapon. Two arrested.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Theft',
        date_reported: '2025-04-10T13:00:00-04:00',
        latitude: 43.6387,
        longitude: -79.4292,
        address: '150 Roncesvalles Ave',
        neighbourhood: 'Roncesvalles',
        description: 'Porch pirate stole multiple packages from residential homes on the street.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Break & Enter',
        date_reported: '2025-04-15T02:00:00-04:00',
        latitude: 43.7920,
        longitude: -79.4163,
        address: '4700 Keele St',
        neighbourhood: 'York University Heights',
        description: 'Student dormitory break-in. Laptops and gaming consoles stolen from two rooms.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Auto Theft',
        date_reported: '2025-04-20T04:15:00-04:00',
        latitude: 43.5890,
        longitude: -79.6441,
        address: '100 City Centre Dr',
        neighbourhood: 'Mississauga City Centre',
        description: 'Range Rover stolen from condo underground parking. Building cameras captured event.',
        source_url: 'https://data.torontopolice.on.ca',
    },
    {
        crime_type: 'Shooting',
        date_reported: '2025-04-25T22:00:00-04:00',
        latitude: 43.6939,
        longitude: -79.4653,
        address: '1220 St Clair Ave W',
        neighbourhood: 'Corso Italia',
        description: 'Drive-by shooting outside a restaurant. No injuries reported. Investigation ongoing.',
        source_url: 'https://data.torontopolice.on.ca',
    },
];

async function seed() {
    console.log('🌱 Seeding GTATO database with 20 sample crime entries...\n');

    const { data, error } = await supabase
        .from('crimes')
        .insert(SAMPLE_CRIMES)
        .select();

    if (error) {
        console.error('❌ Seeding failed:', error.message);
        process.exit(1);
    }

    console.log(`✅ Successfully inserted ${data.length} crime records.\n`);
    data.forEach((row, i) => {
        console.log(`  ${i + 1}. [${row.crime_type}] ${row.address} — ${row.neighbourhood}`);
    });
    console.log('\n🗺️  Your GTATO map is ready to go!');
}

seed();
