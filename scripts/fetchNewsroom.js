/**
 * GTATO — Toronto Police Newsroom Scraper
 *
 * Scrapes the TPS media centre for recent press releases,
 * extracts crime details and addresses, geocodes via Nominatim,
 * and inserts into the Supabase crimes table.
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
const TPS_BASE = 'https://www.tps.ca';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'GTATO-CrimeMap/1.0';
const DAYS_BACK = 7;
const NOW_ISO = new Date().toISOString();

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

/**
 * Detect crime type from text using keyword patterns.
 */
function detectCrimeType(text) {
    if (!text) return null;
    for (const { pattern, type } of CRIME_KEYWORDS) {
        if (pattern.test(text)) return type;
    }
    return null;
}

// ── Address Extraction ────────────────────────────────────

/**
 * Extract intersection-style addresses from text.
 * Matches patterns like "Queen Street West and Jameson Avenue"
 * or "Yonge St / Dundas St".
 */
function extractAddresses(text) {
    if (!text) return [];
    const addresses = [];

    // Intersection pattern: "Street and Street" or "Street / Street"
    const intersectionRegex = /\b(\d*\s*[A-Z][a-z]+(?:\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Way|Place|Pl|Parkway|Pkwy|Trail|Trl|Circle|Cir|Gate|Terrace|Terr)\.?\s*(?:East|West|North|South|E|W|N|S)?)\s+(?:and|&|\/|at)\s+[A-Z][a-z]+(?:\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Way|Place|Pl|Parkway|Pkwy|Trail|Trl|Circle|Cir|Gate|Terrace|Terr)\.?\s*(?:East|West|North|South|E|W|N|S)?))\b/gi;

    let match;
    while ((match = intersectionRegex.exec(text)) !== null) {
        addresses.push(match[0].trim());
    }

    // Numbered street address: "123 Some Street"
    const numberedRegex = /\b(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Za-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Way|Place|Pl|Parkway|Pkwy|Trail|Trl|Circle|Cir|Gate|Terrace|Terr)\.?\s*(?:East|West|North|South|E|W|N|S)?)\b/gi;

    while ((match = numberedRegex.exec(text)) !== null) {
        // Avoid duplicates from intersection matches
        const addr = match[0].trim();
        if (!addresses.some(a => a.includes(addr))) {
            addresses.push(addr);
        }
    }

    return addresses;
}

// ── Fetch Helpers ─────────────────────────────────────────

/**
 * Fetch a URL with a browser-like User-Agent.
 */
async function fetchPage(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        },
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return res.text();
}

/**
 * Sleep for ms milliseconds.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Step 1: Scrape newsroom listing ───────────────────────

async function scrapeNewsListing() {
    console.log('📰 Scraping TPS newsroom listing...');
    console.log(`   URL: ${TPS_NEWSROOM_URL}\n`);

    const html = await fetchPage(TPS_NEWSROOM_URL);
    const $ = cheerio.load(html);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_BACK);

    const releases = [];

    // TPS newsroom uses article/card-like elements for press releases
    // Try multiple possible selectors
    const selectors = [
        'article', '.news-release', '.media-item', '.post-item',
        '.news-item', '.release-item', '.card', '.list-item',
        'li a[href*="news-releases"]', '.view-content .views-row',
    ];

    let items = $([]);
    for (const sel of selectors) {
        items = $(sel);
        if (items.length > 0) {
            console.log(`   Found ${items.length} items using selector: "${sel}"`);
            break;
        }
    }

    // If no items found via selectors, try finding all links to news releases
    if (items.length === 0) {
        console.log('   No structured items found, scanning all links...');
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes('news-releases/') && href !== '/media-centre/news-releases/') {
                const title = $(el).text().trim();
                if (title && title.length > 10) {
                    const fullUrl = href.startsWith('http') ? href : `${TPS_BASE}${href}`;
                    releases.push({ title, url: fullUrl, date: null });
                }
            }
        });
        console.log(`   Found ${releases.length} press release links`);
        return releases;
    }

    items.each((_, el) => {
        const $el = $(el);

        // Extract link
        const $link = $el.find('a').first();
        let href = $link.attr('href') || $el.find('a[href]').first().attr('href') || '';
        if (!href) return;
        const fullUrl = href.startsWith('http') ? href : `${TPS_BASE}${href}`;

        // Extract title
        const title = $link.text().trim()
            || $el.find('h2, h3, h4, .title').first().text().trim()
            || '';
        if (!title) return;

        // Extract date
        const dateText = $el.find('time, .date, .post-date, .release-date, .meta').first().text().trim()
            || $el.find('[datetime]').first().attr('datetime')
            || '';
        let releaseDate = null;
        if (dateText) {
            const d = new Date(dateText);
            if (!isNaN(d.getTime())) releaseDate = d;
        }

        // Only include recent releases if we can parse the date
        if (releaseDate && releaseDate < cutoff) return;

        releases.push({ title, url: fullUrl, date: releaseDate });
    });

    console.log(`   Found ${releases.length} recent press releases`);
    return releases;
}

// ── Step 2: Fetch full press release content ──────────────

async function fetchReleaseContent(release) {
    try {
        console.log(`   📄 Fetching: ${release.title.substring(0, 80)}...`);
        const html = await fetchPage(release.url);
        const $ = cheerio.load(html);

        // Extract main content
        const bodyText = $('article, .content, .post-content, .entry-content, .news-content, main')
            .first().text().trim()
            || $('body').text().trim();

        // Try to find the date from the full page if not already set
        if (!release.date) {
            const dateEl = $('time, .date, .post-date, [datetime]').first();
            const dateStr = dateEl.attr('datetime') || dateEl.text().trim();
            if (dateStr) {
                const d = new Date(dateStr);
                if (!isNaN(d.getTime())) release.date = d;
            }
        }

        return bodyText;
    } catch (err) {
        console.warn(`   ⚠️  Failed to fetch ${release.url}: ${err.message}`);
        return '';
    }
}

// ── Step 3: Geocode via Nominatim ─────────────────────────

async function geocodeAddress(address) {
    const query = `${address}, Toronto, Ontario, Canada`;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
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

    // Step 1: Scrape the listing page
    let releases;
    try {
        releases = await scrapeNewsListing();
    } catch (err) {
        console.error(`❌ Failed to scrape newsroom listing: ${err.message}`);
        process.exit(1);
    }

    if (releases.length === 0) {
        console.log('\nℹ️  No recent press releases found. Nothing to do.');
        process.exit(0);
    }

    // Step 2: Fetch full content and extract details for each release
    console.log(`\n📰 Processing ${releases.length} press releases...\n`);
    const incidents = [];

    for (const release of releases) {
        const bodyText = await fetchReleaseContent(release);
        const fullText = `${release.title} ${bodyText}`;

        // Detect crime type
        const crimeType = detectCrimeType(fullText);
        if (!crimeType) {
            console.log(`   ⏭️  Skipping (no crime keywords): ${release.title.substring(0, 60)}...`);
            continue;
        }

        // Extract addresses
        const addresses = extractAddresses(fullText);
        if (addresses.length === 0) {
            console.log(`   ⏭️  Skipping (no address found): ${release.title.substring(0, 60)}...`);
            continue;
        }

        incidents.push({
            title: release.title,
            url: release.url,
            date: release.date,
            crimeType,
            address: addresses[0], // use first address found
            bodyText: fullText.substring(0, 500), // truncated for description
        });

        // Small delay between page fetches to be polite
        await sleep(500);
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
