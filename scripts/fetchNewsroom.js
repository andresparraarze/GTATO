/**
 * GTATO — Toronto Crime News Scraper
 *
 * Scrapes public Toronto news RSS feeds (CBC, CP24, Toronto Star)
 * for crime-related articles, extracts addresses, geocodes via
 * Nominatim, and inserts into the Supabase crimes table.
 *
 * Env vars required:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Service role key (bypasses RLS)
 *
 * Usage:
 *   node scripts/fetchNewsroom.js
 *   npm run fetch-newsroom
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';

// ── Supabase Setup ────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Missing env vars.');
    console.error('   Need: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Config ────────────────────────────────────────────────
const RSS_FEEDS = [
    { name: 'CBC Toronto', url: 'https://www.cbc.ca/cmlink/rss-canada-toronto' },
    { name: 'CP24', url: 'https://www.cp24.com/rss/cp24-top-stories-1.1765057' },
    { name: 'Toronto Star', url: 'https://www.thestar.com/search/?f=rss&t=article&c=news/gta*' },
];

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA = 'GTATO-CrimeMap/1.0';
const DAYS_BACK = 7;
const NOW_ISO = new Date().toISOString();

// ── Crime Keyword Filter ──────────────────────────────────
// Articles must match at least one of these to be considered crime-related
const CRIME_FILTER_KEYWORDS = /\b(shooting|stabbing|assault|robbery|homicide|murder|arrested|charged|break\s*(and|&)\s*enter|theft|missing|firearm|weapon|police|tps|toronto\s*police)\b/i;

// ── Crime Type Detection ──────────────────────────────────
const CRIME_TYPE_RULES = [
    { pattern: /\bshooting\b|\bfirearm\b|\bgunfire\b|\bshot\b/i, type: 'Shooting' },
    { pattern: /\bhomicide\b|\bmurder\b|\bkilling\b/i, type: 'Homicide' },
    { pattern: /\bsexual\s*assault\b|\bsexual\s*violation\b/i, type: 'Sexual Violation' },
    { pattern: /\bstabbing\b|\bstabbed\b|\bassault\b/i, type: 'Assault' },
    { pattern: /\brobbery\b|\brobbed\b/i, type: 'Robbery' },
    { pattern: /\bbreak\s*(and|&)\s*enter\b|\bbreak-in\b|\bburglary\b/i, type: 'Break and Enter' },
    { pattern: /\bauto\s*theft\b|\bcar\s*theft\b|\bcarjack\b|\bstolen\s*vehicle\b/i, type: 'Auto Theft' },
    { pattern: /\btheft\b|\bstolen\b/i, type: 'Theft Over' },
];

function detectCrimeType(text) {
    if (!text) return null;
    for (const { pattern, type } of CRIME_TYPE_RULES) {
        if (pattern.test(text)) return type;
    }
    return 'Assault'; // default for generic "arrested", "charged", "police" matches
}

// ── Address Extraction ────────────────────────────────────
const STREET_SUFFIX = '(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Way|Place|Pl|Parkway|Pkwy|Trail|Trl|Circle|Cir|Gate|Terrace|Terr)\\.?';
const DIRECTION = '(?:\\s+(?:East|West|North|South|E|W|N|S))?';

function extractAddresses(text) {
    if (!text) return [];
    const addresses = [];

    // Intersection: "Queen Street West and Jameson Avenue"
    const intersectionRegex = new RegExp(
        `\\b(\\d*\\s*[A-Z][a-z]+(?:\\s+[A-Za-z]+)*\\s+${STREET_SUFFIX}${DIRECTION}\\s+(?:and|&|at|near)\\s+[A-Z][a-z]+(?:\\s+[A-Za-z]+)*\\s+${STREET_SUFFIX}${DIRECTION})\\b`,
        'gi'
    );
    let match;
    while ((match = intersectionRegex.exec(text)) !== null) {
        addresses.push(match[0].trim());
    }

    // Numbered address: "123 Some Street"
    const numberedRegex = new RegExp(
        `\\b(\\d{1,5}\\s+[A-Z][a-z]+(?:\\s+[A-Za-z]+)*\\s+${STREET_SUFFIX}${DIRECTION})\\b`,
        'gi'
    );
    while ((match = numberedRegex.exec(text)) !== null) {
        const addr = match[0].trim();
        if (!addresses.some(a => a.includes(addr))) {
            addresses.push(addr);
        }
    }

    // Area/neighbourhood mentions as fallback (common Toronto areas)
    if (addresses.length === 0) {
        const areaRegex = /\b(Scarborough|Etobicoke|North York|East York|Downtown|Midtown|Yorkdale|Rexdale|Jane\s+and\s+Finch|Regent\s+Park|Moss\s+Park|Parkdale|Liberty\s+Village|Kensington|Chinatown|Danforth|Beaches|Leslieville)\b/gi;
        while ((match = areaRegex.exec(text)) !== null) {
            addresses.push(match[0].trim());
        }
    }

    return addresses;
}

// ── Helpers ───────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Strip HTML tags from a string.
 */
function stripHTML(str) {
    if (!str) return '';
    return String(str).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── RSS Fetching ──────────────────────────────────────────

async function fetchRSSFeed(feed) {
    console.log(`   📡 ${feed.name}: ${feed.url}`);

    try {
        const res = await fetch(feed.url, {
            headers: {
                'User-Agent': NOMINATIM_UA,
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            },
        });

        if (!res.ok) {
            console.warn(`   ⚠️  ${feed.name}: HTTP ${res.status} ${res.statusText} — skipping`);
            return [];
        }

        const xml = await res.text();
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
        });
        const parsed = parser.parse(xml);

        // Handle RSS 2.0 and Atom formats
        let items = parsed?.rss?.channel?.item       // RSS 2.0
            || parsed?.feed?.entry                     // Atom
            || [];

        if (!Array.isArray(items)) items = [items];

        console.log(`   ✓ ${feed.name}: ${items.length} total items`);
        return items.map(item => ({
            title: stripHTML(item.title || ''),
            link: item.link?.['@_href'] || item.link || item.guid || '',
            pubDate: item.pubDate || item.published || item.updated || '',
            description: stripHTML(item.description || item.summary || item.content || ''),
            source: feed.name,
        }));
    } catch (err) {
        console.warn(`   ⚠️  ${feed.name}: fetch error — ${err.message}`);
        return [];
    }
}

// ── Geocode via Nominatim ─────────────────────────────────

async function geocodeAddress(address) {
    const query = `${address}, Toronto, Ontario, Canada`;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': NOMINATIM_UA },
        });
        if (!res.ok) return null;

        const results = await res.json();
        if (results.length === 0) return null;

        const latF = parseFloat(results[0].lat);
        const lngF = parseFloat(results[0].lon);

        // Sanity check — should be roughly in the GTA
        if (latF < 43.0 || latF > 44.5 || lngF < -80.5 || lngF > -78.5) return null;

        console.log(`      📍 ${address} → (${latF.toFixed(4)}, ${lngF.toFixed(4)})`);
        return { lat: latF, lng: lngF };
    } catch {
        return null;
    }
}

// ── Main ──────────────────────────────────────────────────

async function main() {
    console.log('\n🚔 GTATO — Toronto Crime News Scraper');
    console.log(`📅 Scanning RSS feeds for crime articles from the last ${DAYS_BACK} days\n`);

    // Step 1: Fetch all RSS feeds
    console.log('📡 Fetching RSS feeds...\n');
    let allArticles = [];

    for (const feed of RSS_FEEDS) {
        const items = await fetchRSSFeed(feed);
        allArticles.push(...items);
        await sleep(500); // small delay between feeds
    }

    console.log(`\n📊 Total articles fetched: ${allArticles.length}`);

    // Step 2: Filter to last 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_BACK);

    const recentArticles = allArticles.filter(a => {
        if (!a.pubDate) return true; // include if no date (might be recent)
        const d = new Date(a.pubDate);
        return !isNaN(d.getTime()) && d >= cutoff;
    });

    console.log(`📊 Articles from last ${DAYS_BACK} days: ${recentArticles.length}`);

    // Step 3: Filter to crime-related articles
    const crimeArticles = recentArticles.filter(a => {
        const text = `${a.title} ${a.description}`;
        return CRIME_FILTER_KEYWORDS.test(text);
    });

    console.log(`📊 Crime-related articles: ${crimeArticles.length}`);

    if (crimeArticles.length === 0) {
        console.log('\nℹ️  No crime-related articles found. Nothing to do.');
        process.exit(0);
    }

    // Step 4: Extract crime type + addresses
    console.log(`\n📰 Processing ${crimeArticles.length} crime articles...\n`);
    const incidents = [];

    for (const article of crimeArticles) {
        const fullText = `${article.title} ${article.description}`;
        const crimeType = detectCrimeType(fullText);
        const addresses = extractAddresses(fullText);

        if (addresses.length === 0) {
            console.log(`   ⏭️  No address: ${article.title.substring(0, 70)}`);
            continue;
        }

        console.log(`   ✓ [${crimeType}] ${addresses[0]} — ${article.title.substring(0, 50)}`);

        incidents.push({
            title: article.title,
            url: typeof article.link === 'string' ? article.link : '',
            date: article.pubDate ? new Date(article.pubDate) : null,
            crimeType,
            address: addresses[0],
            source: article.source,
        });
    }

    console.log(`\n📊 ${incidents.length} incidents with extractable addresses`);

    if (incidents.length === 0) {
        console.log('\nℹ️  No geocodable incidents found. Nothing to insert.');
        process.exit(0);
    }

    // Step 5: Geocode each incident
    console.log('\n🌍 Geocoding addresses via Nominatim...\n');
    const rows = [];
    let geocodeFails = 0;

    for (const incident of incidents) {
        const coords = await geocodeAddress(incident.address);

        if (coords) {
            rows.push({
                crime_type: incident.crimeType,
                lat: coords.lat,
                lng: coords.lng,
                date_reported: incident.date && !isNaN(incident.date.getTime())
                    ? incident.date.toISOString()
                    : NOW_ISO,
                neighbourhood: null,
                address: incident.address,
                description: incident.title,
                source_url: incident.url,
                last_updated: NOW_ISO,
            });
        } else {
            geocodeFails++;
        }

        // Rate limit: 1 request per second for Nominatim
        await sleep(1000);
    }

    console.log(`\n📊 Geocoded: ${rows.length} success, ${geocodeFails} failed`);

    if (rows.length === 0) {
        console.log('\nℹ️  No incidents could be geocoded. Nothing to insert.');
        process.exit(0);
    }

    // Step 6: Insert into Supabase
    console.log('\n📥 Inserting into Supabase...');

    const { data, error } = await supabase
        .from('crimes')
        .insert(rows)
        .select('id');

    if (error) {
        console.error('❌ Supabase INSERT failed:');
        console.error(`   Message: ${error.message}`);
        console.error(`   Code: ${error.code}`);
        console.error(`   Details: ${JSON.stringify(error.details)}`);
        process.exit(1);
    }

    console.log(`   ✓ Inserted ${data.length} incidents from news feeds`);

    // Summary
    const counts = {};
    rows.forEach(r => { counts[r.crime_type] = (counts[r.crime_type] || 0) + 1; });
    const sources = {};
    incidents.filter((_, i) => i < rows.length).forEach(inc => {
        sources[inc.source] = (sources[inc.source] || 0) + 1;
    });

    console.log('\n📋 Crime type breakdown:');
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`   ${t}: ${c}`));

    console.log('\n📰 Source breakdown:');
    Object.entries(sources).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => console.log(`   ${s}: ${c}`));

    console.log(`\n✅ Done — ${data.length} news incidents added to Supabase\n`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
