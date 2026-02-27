/**
 * GTATO — Santa Cruz de la Sierra Crime News Scraper
 *
 * Scrapes Bolivian news sources for crime-related articles in
 * Santa Cruz de la Sierra, geocodes via Nominatim, and inserts
 * into the Supabase crimes table as append-only records.
 *
 * Data sources:
 *   1. El Deber (RSS feed)
 *   2. El Mundo (HTML scrape)
 *   3. Unitel (HTML scrape)
 *   4. Red Uno (HTML scrape)
 *
 * CRITICAL: This script is APPEND-ONLY. It never deletes or updates
 *           existing records. Before inserting, it checks if a record
 *           with the same source_url already exists and skips it.
 *
 * Env vars required:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Service role key (bypasses RLS)
 *
 * Usage:
 *   node scripts/fetchSantaCruz.js
 *   npm run fetch-santa-cruz
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
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
const DAYS_BACK = 30;
const NOW_ISO = new Date().toISOString();
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA = 'GTATO-CrimeMap/1.0';

// Fallback coordinates — Santa Cruz city center
const DEFAULT_LAT = -17.7833;
const DEFAULT_LNG = -63.1821;

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-BO,es;q=0.9,en;q=0.5',
};

// ── News Sources ──────────────────────────────────────────
const SOURCES = [
    { name: 'El Deber', type: 'rss', url: 'https://eldeber.com.bo/rss/feed' },
    { name: 'El Mundo', type: 'html', url: 'https://elmundo.com.bo' },
    { name: 'Unitel', type: 'html', url: 'https://unitel.bo/policiales' },
    { name: 'Red Uno', type: 'html', url: 'https://www.reduno.com.bo' },
];

// ── Spanish Crime Keyword Filter ──────────────────────────
const CRIME_FILTER = /\b(santa\s*cruz|asesinato|homicidio|femicidio|feminicidio|robo|asalto|balacera|disparo|baleado|aprehendido|detenido|arrestado|crimen|delito|violaci[oó]n|secuestro|narcotr[aá]fico|droga|sicario|extorsi[oó]n|atraco|carterista|hurto|estafa|violencia|muerto|herido|fallecido|accidente|choque)\b/i;

// ── Crime Type Detection ──────────────────────────────────
const CRIME_TYPE_RULES = [
    { pattern: /\basesinato\b|\bhomicidio\b|\bfemicidio\b|\bfeminicidio\b|\bmuerto\b|\bfallecido\b/i, type: 'Homicidio' },
    { pattern: /\bbalacera\b|\bdisparo\b|\bbaleado\b|\bsicario\b/i, type: 'Balacera' },
    { pattern: /\brobo\b|\basalto\b|\batraco\b/i, type: 'Robo' },
    { pattern: /\bviolaci[oó]n\b/i, type: 'Violación' },
    { pattern: /\bsecuestro\b/i, type: 'Secuestro' },
    { pattern: /\bnarcotr[aá]fico\b|\bdroga\b/i, type: 'Narcotráfico' },
    { pattern: /\bextorsi[oó]n\b/i, type: 'Extorsión' },
    { pattern: /\bhurto\b|\bcarterista\b|\bestafa\b/i, type: 'Hurto' },
    { pattern: /\bviolencia\b|\bherido\b/i, type: 'Violencia' },
    { pattern: /\baccidente\b|\bchoque\b/i, type: 'Accidente' },
];

function detectCrimeType(text) {
    if (!text) return 'Incidente';
    for (const { pattern, type } of CRIME_TYPE_RULES) {
        if (pattern.test(text)) return type;
    }
    return 'Incidente';
}

// ── Address Extraction ────────────────────────────────────
function extractAddress(text) {
    if (!text) return null;

    // Santa Cruz street patterns: anillo, avenida, barrio, zona, radial, entre calles
    const patterns = [
        /(?:entre\s+calles?\s+)(.+?)(?:\.|,|$)/i,
        /\b((?:avenida|av\.?)\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú][a-zá-ú]+)*)/i,
        /\b((?:\d+(?:er|do|to|vo)?\s+)?anillo\s*(?:interno|externo)?)/i,
        /\b(radial\s+\d+(?:\s+[a-zá-ú]+)?)/i,
        /\b(barrio\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú][a-zá-ú]+)*)/i,
        /\b(zona\s+(?:norte|sur|este|oeste|central|[A-ZÁ-Ú][a-zá-ú]+))/i,
        /\b(calle\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú0-9][a-zá-ú0-9]*)*)/i,
        /\b(villa\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+(?:de\s+)?[A-ZÁ-Ú][a-zá-ú]+)*)/i,
        /\b(plan\s+(?:tres\s+mil|3000))/i,
        /\b(mercado\s+[A-ZÁ-Ú][a-zá-ú]+)/i,
    ];

    for (const regex of patterns) {
        const match = text.match(regex);
        if (match) return match[1] || match[0];
    }

    return null;
}

// ── Helpers ───────────────────────────────────────────────
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHTML(str) {
    if (!str) return '';
    return String(str).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ── RSS Feed Parser ───────────────────────────────────────
async function fetchRSS(source) {
    console.log(`   📡 ${source.name}: ${source.url}`);
    try {
        const res = await fetch(source.url, {
            headers: { 'User-Agent': NOMINATIM_UA, 'Accept': 'application/rss+xml, text/xml, */*' },
        });
        if (!res.ok) {
            console.warn(`   ⚠️  ${source.name}: HTTP ${res.status} — skipping`);
            return [];
        }

        const xml = await res.text();
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
        const parsed = parser.parse(xml);

        let items = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
        if (!Array.isArray(items)) items = [items];

        const articles = items.map(item => ({
            title: stripHTML(item.title || ''),
            link: item.link?.['@_href'] || item.link || item.guid || '',
            pubDate: item.pubDate || item.published || '',
            description: stripHTML(item.description || item.summary || ''),
            source: source.name,
        }));

        console.log(`   ✓ ${source.name}: ${articles.length} articles`);
        return articles;
    } catch (err) {
        console.warn(`   ⚠️  ${source.name}: ${err.message}`);
        return [];
    }
}

// ── HTML Scraper ──────────────────────────────────────────
async function fetchHTML(source) {
    console.log(`   📡 ${source.name}: ${source.url}`);
    try {
        const res = await fetch(source.url, { headers: BROWSER_HEADERS });
        if (!res.ok) {
            console.warn(`   ⚠️  ${source.name}: HTTP ${res.status} — skipping`);
            return [];
        }

        const html = await res.text();
        const $ = cheerio.load(html);
        const articles = [];

        // Try common article/card selectors
        const selectors = ['article', '.card', '.news-item', '.post-item', '.nota', '.noticia', '.article-item', 'li'];
        let items = $([]);
        for (const sel of selectors) {
            items = $(sel);
            if (items.length > 3) break; // found meaningful content
        }

        items.each((_, el) => {
            const $el = $(el);
            const $link = $el.find('a').first();
            let href = $link.attr('href') || '';
            if (!href) return;

            // Make absolute URL
            if (href.startsWith('/')) {
                const base = new URL(source.url);
                href = `${base.origin}${href}`;
            } else if (!href.startsWith('http')) {
                return;
            }

            const title = $link.text().trim()
                || $el.find('h2, h3, h4, .title, .headline').first().text().trim()
                || '';
            if (!title || title.length < 10) return;

            const dateText = $el.find('time, .date, .fecha, [datetime]').first().text().trim()
                || $el.find('[datetime]').first().attr('datetime')
                || '';

            const description = $el.find('.summary, .excerpt, .descripcion, p').first().text().trim() || '';

            articles.push({
                title: title.substring(0, 300),
                link: href,
                pubDate: dateText,
                description: description.substring(0, 500),
                source: source.name,
            });
        });

        // Fallback: scan all links for news-like paths
        if (articles.length === 0) {
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const title = $(el).text().trim();
                if (title && title.length > 20 && (href.includes('/nota') || href.includes('/policial') || href.includes('/seguridad') || href.includes('/suceso'))) {
                    const fullUrl = href.startsWith('http') ? href : `${new URL(source.url).origin}${href}`;
                    articles.push({
                        title: title.substring(0, 300),
                        link: fullUrl,
                        pubDate: '',
                        description: '',
                        source: source.name,
                    });
                }
            });
        }

        console.log(`   ✓ ${source.name}: ${articles.length} articles`);
        return articles;
    } catch (err) {
        console.warn(`   ⚠️  ${source.name}: ${err.message}`);
        return [];
    }
}

// ── Geocode via Nominatim ─────────────────────────────────
async function geocodeAddress(address) {
    const query = `${address}, Santa Cruz de la Sierra, Bolivia`;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;

    try {
        const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA } });
        if (!res.ok) return null;

        const results = await res.json();
        if (results.length === 0) return null;

        const latF = parseFloat(results[0].lat);
        const lngF = parseFloat(results[0].lon);

        // Sanity check — roughly Santa Cruz area
        if (latF < -18.5 || latF > -17.0 || lngF < -64.0 || lngF > -62.5) return null;

        console.log(`      📍 ${address} → (${latF.toFixed(4)}, ${lngF.toFixed(4)})`);
        return { lat: latF, lng: lngF };
    } catch {
        return null;
    }
}

// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log('\n🚔 GTATO — Santa Cruz de la Sierra Crime Scraper');
    console.log(`📅 Scanning news sources for the last ${DAYS_BACK} days`);
    console.log('⚠️  APPEND-ONLY MODE — existing records will never be deleted\n');

    // Step 1: Fetch from all sources
    console.log('📡 Fetching news sources...\n');
    let allArticles = [];
    const sourceCounts = {};

    for (const source of SOURCES) {
        const articles = source.type === 'rss'
            ? await fetchRSS(source)
            : await fetchHTML(source);
        sourceCounts[source.name] = { fetched: articles.length, matched: 0, geocoded: 0, fallback: 0, inserted: 0 };
        allArticles.push(...articles);
        await sleep(500);
    }

    console.log(`\n📊 Total articles fetched: ${allArticles.length}`);
    for (const [name, c] of Object.entries(sourceCounts)) {
        console.log(`   ${name}: ${c.fetched}`);
    }

    // Step 2: Filter to crime-related articles
    const crimeArticles = allArticles.filter(a => {
        const text = `${a.title} ${a.description}`;
        return CRIME_FILTER.test(text);
    });

    for (const a of crimeArticles) {
        if (sourceCounts[a.source]) sourceCounts[a.source].matched++;
    }

    console.log(`\n📊 Crime-related articles: ${crimeArticles.length}`);

    if (crimeArticles.length === 0) {
        console.log('\nℹ️  No crime-related articles found. Nothing to do.');
        process.exit(0);
    }

    // Log matched articles
    console.log('\n📰 Matched articles:\n');
    for (const a of crimeArticles) {
        console.log(`   [${a.source}] ${a.title.substring(0, 80)}`);
    }

    // Step 3: Check which source_urls already exist in Supabase (dedup)
    console.log('\n🔍 Checking for duplicates...');
    const urls = crimeArticles.map(a => typeof a.link === 'string' ? a.link : '').filter(Boolean);
    const { data: existing } = await supabase
        .from('crimes')
        .select('source_url')
        .in('source_url', urls.slice(0, 500)); // Supabase has a limit
    const existingUrls = new Set((existing || []).map(r => r.source_url));
    console.log(`   ${existingUrls.size} articles already in database`);

    // Step 4: Process new articles — detect type, extract address, geocode
    console.log('\n📰 Processing new articles...\n');
    const rows = [];
    let geocodeSuccess = 0;
    let geocodeFallback = 0;
    let skippedDupes = 0;

    for (const article of crimeArticles) {
        const articleUrl = typeof article.link === 'string' ? article.link : '';

        // Skip duplicates
        if (articleUrl && existingUrls.has(articleUrl)) {
            skippedDupes++;
            continue;
        }

        const fullText = `${article.title} ${article.description}`;
        const crimeType = detectCrimeType(fullText);
        const address = extractAddress(fullText);

        // Geocode
        let lat = DEFAULT_LAT;
        let lng = DEFAULT_LNG;
        let usedFallback = true;

        if (address) {
            const coords = await geocodeAddress(address);
            if (coords) {
                lat = coords.lat;
                lng = coords.lng;
                usedFallback = false;
                geocodeSuccess++;
                if (sourceCounts[article.source]) sourceCounts[article.source].geocoded++;
            } else {
                geocodeFallback++;
                if (sourceCounts[article.source]) sourceCounts[article.source].fallback++;
            }
            await sleep(1000); // Nominatim rate limit
        } else {
            geocodeFallback++;
            if (sourceCounts[article.source]) sourceCounts[article.source].fallback++;
        }

        // Parse date
        let dateISO = NOW_ISO;
        if (article.pubDate) {
            const d = new Date(article.pubDate);
            if (!isNaN(d.getTime())) dateISO = d.toISOString();
        }

        console.log(`   ${usedFallback ? '📌' : '📍'} [${crimeType}] ${article.title.substring(0, 60)}`);

        rows.push({
            crime_type: crimeType,
            city: 'santa_cruz',
            lat,
            lng,
            date_reported: dateISO,
            neighbourhood: null,
            address: address || 'Santa Cruz (aproximado)',
            description: article.title,
            source_url: articleUrl,
            last_updated: NOW_ISO,
        });
    }

    console.log(`\n📊 New records: ${rows.length}, Duplicates skipped: ${skippedDupes}`);
    console.log(`📊 Geocoding: ${geocodeSuccess} precise, ${geocodeFallback} fallback`);

    if (rows.length === 0) {
        console.log('\nℹ️  No new records to insert. All articles already in database.');
        process.exit(0);
    }

    // Step 5: Insert into Supabase (append-only)
    console.log('\n📥 Inserting into Supabase (append-only)...');

    const BATCH = 500;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { data, error } = await supabase.from('crimes').insert(batch).select('id');
        if (error) {
            console.error(`❌ Supabase INSERT failed at batch ${Math.ceil((i + 1) / BATCH)}:`);
            console.error(`   Message: ${error.message}`);
            console.error(`   Code: ${error.code}`);
            continue;
        }
        totalInserted += data.length;
        console.log(`   ✓ Batch ${Math.ceil((i + 1) / BATCH)}: ${data.length} rows`);
    }

    // Summary
    console.log('\n' + '─'.repeat(60));
    console.log('📋 SUMMARY');
    console.log('─'.repeat(60));

    const counts = {};
    rows.forEach(r => { counts[r.crime_type] = (counts[r.crime_type] || 0) + 1; });

    console.log('\n   Crime type breakdown:');
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`      ${t}: ${c}`));

    console.log('\n   Per-source breakdown:');
    console.log('   ' + 'Source'.padEnd(16) + 'Fetched  Matched  Geocoded  Fallback');
    for (const [name, c] of Object.entries(sourceCounts)) {
        console.log(`   ${name.padEnd(16)}${String(c.fetched).padEnd(9)}${String(c.matched).padEnd(9)}${String(c.geocoded).padEnd(10)}${c.fallback}`);
    }

    console.log(`\n   Total inserted: ${totalInserted}`);
    console.log(`   Duplicates skipped: ${skippedDupes}`);

    console.log(`\n✅ Done — ${totalInserted} Santa Cruz incidents added to Supabase\n`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
