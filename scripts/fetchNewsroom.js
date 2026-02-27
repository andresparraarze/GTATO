/**
 * GTATO — Toronto Police Newsroom Scraper
 *
 * Scrapes the TPS media centre for recent press releases,
 * extracts crime details and addresses, geocodes via Nominatim,
 * and inserts into the Supabase crimes table.
 *
 * Strategy:
 *   1. Try scraping the HTML newsroom page with realistic browser headers
 *   2. If that returns 403, fall back to the TPS RSS feed (parsed via fast-xml-parser)
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
import * as cheerio from 'cheerio';
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
const TPS_NEWSROOM_URL = 'https://www.tps.ca/media-centre/news-releases/';
const TPS_RSS_URL = 'https://www.tps.ca/media-centre/news-releases/rss/';
const TPS_BASE = 'https://www.tps.ca';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA = 'GTATO-CrimeMap/1.0';
const DAYS_BACK = 7;
const NOW_ISO = new Date().toISOString();

// Realistic browser headers to avoid 403
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
};

// ── Crime Type Detection ──────────────────────────────────
const CRIME_KEYWORDS = [
    { pattern: /\bshooting\b|\bshot\b|\bfirearm\b|\bgunfire\b/i, type: 'Shooting' },
    { pattern: /\bhomicide\b|\bmurder\b|\bfatal\b/i, type: 'Homicide' },
    { pattern: /\bsexual\s*assault\b|\bsexual\s*violation\b/i, type: 'Sexual Violation' },
    { pattern: /\bassault\b|\bstabbing\b|\bstabbed\b/i, type: 'Assault' },
    { pattern: /\brobbery\b|\brobbed\b/i, type: 'Robbery' },
    { pattern: /\bbreak\s*(and|&)\s*enter\b|\bbreak-in\b|\bburglary\b/i, type: 'Break and Enter' },
    { pattern: /\bauto\s*theft\b|\bcar\s*theft\b|\bcarjack\b|\bstolen\s*vehicle\b/i, type: 'Auto Theft' },
    { pattern: /\bbicycle\s*theft\b|\bstolen\s*bike\b|\bbike\s*theft\b/i, type: 'Bicycle Theft' },
    { pattern: /\btheft\s*from\s*(motor\s*)?vehicle\b|\btheft\s*from\s*mv\b/i, type: 'Theft from MV' },
    { pattern: /\btheft\s*over\b/i, type: 'Theft Over' },
    { pattern: /\btheft\b|\bstolen\b/i, type: 'Theft Over' },
];

function detectCrimeType(text) {
    if (!text) return null;
    for (const { pattern, type } of CRIME_KEYWORDS) {
        if (pattern.test(text)) return type;
    }
    return null;
}

// ── Address Extraction ────────────────────────────────────

function extractAddresses(text) {
    if (!text) return [];
    const addresses = [];

    // Intersection: "Queen Street West and Jameson Avenue"
    const intersectionRegex = /\b(\d*\s*[A-Z][a-z]+(?:\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Way|Place|Pl|Parkway|Pkwy|Trail|Trl|Circle|Cir|Gate|Terrace|Terr)\.?\s*(?:East|West|North|South|E|W|N|S)?)\s+(?:and|&|\/|at)\s+[A-Z][a-z]+(?:\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Way|Place|Pl|Parkway|Pkwy|Trail|Trl|Circle|Cir|Gate|Terrace|Terr)\.?\s*(?:East|West|North|South|E|W|N|S)?))\b/gi;

    let match;
    while ((match = intersectionRegex.exec(text)) !== null) {
        addresses.push(match[0].trim());
    }

    // Numbered address: "123 Some Street"
    const numberedRegex = /\b(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Za-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Way|Place|Pl|Parkway|Pkwy|Trail|Trl|Circle|Cir|Gate|Terrace|Terr)\.?\s*(?:East|West|North|South|E|W|N|S)?)\b/gi;

    while ((match = numberedRegex.exec(text)) !== null) {
        const addr = match[0].trim();
        if (!addresses.some(a => a.includes(addr))) {
            addresses.push(addr);
        }
    }

    return addresses;
}

// ── Helpers ───────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Step 1A: Scrape HTML newsroom listing ─────────────────

async function scrapeHTMLListing() {
    console.log('📰 Trying HTML scrape of TPS newsroom...');
    console.log(`   URL: ${TPS_NEWSROOM_URL}`);

    const res = await fetch(TPS_NEWSROOM_URL, { headers: BROWSER_HEADERS });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_BACK);
    const releases = [];

    // Try multiple selectors
    const selectors = [
        'article', '.news-release', '.media-item', '.post-item',
        '.news-item', '.release-item', '.card', '.list-item',
    ];

    let items = $([]);
    for (const sel of selectors) {
        items = $(sel);
        if (items.length > 0) {
            console.log(`   Found ${items.length} items using selector: "${sel}"`);
            break;
        }
    }

    if (items.length === 0) {
        // Fallback: scan all links
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes('news-releases/') && href !== '/media-centre/news-releases/') {
                const title = $(el).text().trim();
                if (title && title.length > 10) {
                    const fullUrl = href.startsWith('http') ? href : `${TPS_BASE}${href}`;
                    releases.push({ title, url: fullUrl, date: null, description: '' });
                }
            }
        });
    } else {
        items.each((_, el) => {
            const $el = $(el);
            const $link = $el.find('a').first();
            let href = $link.attr('href') || '';
            if (!href) return;
            const fullUrl = href.startsWith('http') ? href : `${TPS_BASE}${href}`;

            const title = $link.text().trim()
                || $el.find('h2, h3, h4, .title').first().text().trim()
                || '';
            if (!title) return;

            const dateText = $el.find('time, .date, .post-date, .release-date, .meta').first().text().trim()
                || $el.find('[datetime]').first().attr('datetime')
                || '';
            let releaseDate = null;
            if (dateText) {
                const d = new Date(dateText);
                if (!isNaN(d.getTime())) releaseDate = d;
            }

            if (releaseDate && releaseDate < cutoff) return;

            releases.push({ title, url: fullUrl, date: releaseDate, description: '' });
        });
    }

    console.log(`   ✓ HTML scrape: ${releases.length} press releases found`);
    return releases;
}

// ── Step 1B: Parse RSS feed (fallback) ────────────────────

async function scrapeRSSFeed() {
    console.log('📡 Trying TPS RSS feed (fallback)...');
    console.log(`   URL: ${TPS_RSS_URL}`);

    const res = await fetch(TPS_RSS_URL, {
        headers: {
            'User-Agent': NOMINATIM_UA,
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
    });
    if (!res.ok) {
        throw new Error(`RSS feed returned HTTP ${res.status} ${res.statusText}`);
    }

    const xml = await res.text();
    console.log(`   ✓ RSS feed downloaded (${xml.length} bytes)`);

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
    });
    const parsed = parser.parse(xml);

    // RSS 2.0 structure: rss > channel > item
    const channel = parsed?.rss?.channel;
    if (!channel) {
        throw new Error('RSS feed has no rss > channel structure');
    }

    let items = channel.item;
    if (!items) {
        throw new Error('RSS feed has no items');
    }
    // Ensure array
    if (!Array.isArray(items)) items = [items];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_BACK);
    const releases = [];

    for (const item of items) {
        const title = item.title || '';
        const link = item.link || '';
        const pubDate = item.pubDate || '';
        const description = item.description || '';

        let releaseDate = null;
        if (pubDate) {
            const d = new Date(pubDate);
            if (!isNaN(d.getTime())) releaseDate = d;
        }

        // Only include recent releases
        if (releaseDate && releaseDate < cutoff) continue;

        releases.push({
            title: String(title).trim(),
            url: String(link).trim(),
            date: releaseDate,
            description: String(description).trim(),
        });
    }

    console.log(`   ✓ RSS feed: ${releases.length} recent press releases`);
    return releases;
}

// ── Step 1: Combined fetch (HTML → RSS fallback) ──────────

async function fetchPressReleases() {
    // Try HTML first
    try {
        const releases = await scrapeHTMLListing();
        if (releases.length > 0) return releases;
        console.log('   ⚠️  HTML scrape returned 0 results, trying RSS...\n');
    } catch (err) {
        console.warn(`   ⚠️  HTML scrape failed: ${err.message}`);
        console.warn('   Falling back to RSS feed...\n');
    }

    // Fall back to RSS
    try {
        return await scrapeRSSFeed();
    } catch (err) {
        console.error(`❌ RSS feed also failed: ${err.message}`);
        process.exit(1);
    }
}

// ── Step 3: Geocode via Nominatim ─────────────────────────

async function geocodeAddress(address) {
    const query = `${address}, Toronto, Ontario, Canada`;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': NOMINATIM_UA },
        });
        if (!res.ok) {
            console.warn(`   ⚠️  Nominatim HTTP ${res.status} for: ${address}`);
            return null;
        }
        const results = await res.json();
        if (results.length === 0) {
            console.warn(`   ⚠️  No geocoding result for: ${address}`);
            return null;
        }

        const { lat, lon } = results[0];
        const latF = parseFloat(lat);
        const lngF = parseFloat(lon);

        // Sanity check — should be roughly in the GTA
        if (latF < 43.0 || latF > 44.5 || lngF < -80.5 || lngF > -78.5) {
            console.warn(`   ⚠️  Geocoded coords outside GTA (${latF}, ${lngF}) for: ${address}`);
            return null;
        }

        console.log(`   📍 Geocoded: ${address} → (${latF.toFixed(4)}, ${lngF.toFixed(4)})`);
        return { lat: latF, lng: lngF };
    } catch (err) {
        console.warn(`   ⚠️  Geocoding error for "${address}": ${err.message}`);
        return null;
    }
}

// ── Main ──────────────────────────────────────────────────

async function main() {
    console.log('\n🚔 GTATO — TPS Newsroom Scraper');
    console.log(`📅 Looking for press releases from the last ${DAYS_BACK} days\n`);

    // Step 1: Fetch press releases (HTML → RSS fallback)
    const releases = await fetchPressReleases();

    if (releases.length === 0) {
        console.log('\nℹ️  No recent press releases found. Nothing to do.');
        process.exit(0);
    }

    // Step 2: Process each release — detect crime type + extract addresses
    console.log(`\n📰 Processing ${releases.length} press releases...\n`);
    const incidents = [];

    for (const release of releases) {
        // Combine title + description for keyword and address matching
        const fullText = `${release.title} ${release.description}`;

        // Detect crime type
        const crimeType = detectCrimeType(fullText);
        if (!crimeType) {
            console.log(`   ⏭️  Skip (no crime keywords): ${release.title.substring(0, 70)}`);
            continue;
        }

        // Extract addresses
        const addresses = extractAddresses(fullText);
        if (addresses.length === 0) {
            console.log(`   ⏭️  Skip (no address found): ${release.title.substring(0, 70)}`);
            continue;
        }

        console.log(`   ✓ ${crimeType} — ${addresses[0]}`);

        incidents.push({
            title: release.title,
            url: release.url,
            date: release.date,
            crimeType,
            address: addresses[0],
        });
    }

    console.log(`\n📊 ${incidents.length} incidents with crime type + address detected`);

    if (incidents.length === 0) {
        console.log('\nℹ️  No geocodable incidents found. Nothing to insert.');
        process.exit(0);
    }

    // Step 3: Geocode each incident
    console.log('\n🌍 Geocoding addresses via Nominatim...\n');
    const rows = [];

    for (const incident of incidents) {
        const coords = await geocodeAddress(incident.address);

        if (coords) {
            rows.push({
                crime_type: incident.crimeType,
                lat: coords.lat,
                lng: coords.lng,
                date_reported: incident.date ? incident.date.toISOString() : NOW_ISO,
                neighbourhood: null,
                address: incident.address,
                description: incident.title,
                source_url: incident.url,
                last_updated: NOW_ISO,
            });
        }

        // Rate limit: 1 request per second for Nominatim
        await sleep(1000);
    }

    console.log(`\n📊 ${rows.length} incidents successfully geocoded`);

    if (rows.length === 0) {
        console.log('\nℹ️  No incidents could be geocoded. Nothing to insert.');
        process.exit(0);
    }

    // Step 4: Insert into Supabase
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

    console.log(`   ✓ Inserted ${data.length} newsroom incidents`);

    // Summary
    const counts = {};
    rows.forEach(r => { counts[r.crime_type] = (counts[r.crime_type] || 0) + 1; });

    console.log('\n📋 Crime type breakdown:');
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`   ${t}: ${c}`));

    console.log(`\n✅ Done — ${data.length} newsroom incidents added to Supabase\n`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
