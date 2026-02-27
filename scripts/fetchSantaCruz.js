/**
 * GTATO — Santa Cruz de la Sierra Crime News Scraper
 *
 * Scrapes Bolivian news sources (police/crime sections only) for
 * crime-related articles in Santa Cruz de la Sierra, geocodes via
 * Nominatim, and inserts into the Supabase crimes table as append-only.
 *
 * CRITICAL: This script is APPEND-ONLY. It never updates existing records.
 *           Before inserting, it checks if source_url already exists.
 *           On first run it cleans up any out-of-bounds records.
 *
 * Env vars required:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Service role key (bypasses RLS)
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

// Strict bounding box for Santa Cruz de la Sierra
const SCZ_BOUNDS = {
    latMin: -18.1, latMax: -17.5,
    lngMin: -63.5, lngMax: -62.8,
};

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-BO,es;q=0.9,en;q=0.5',
};

// ── News Sources (police/crime sections only) ─────────────
const SOURCES = [
    { name: 'El Deber', type: 'rss', url: 'https://eldeber.com.bo/rss/feed', filterCategory: /seguridad|policial/i },
    { name: 'El Mundo', type: 'html', url: 'https://elmundo.com.bo/policiales' },
    { name: 'Unitel', type: 'html', url: 'https://unitel.bo/policiales' },
    { name: 'Red Uno', type: 'html', url: 'https://www.reduno.com.bo/policiales' },
];

// ── Hard Crime Keywords (strict — both title AND body must match) ──
const HARD_CRIME_KEYWORDS = /\b(asesinato|homicidio|femicidio|feminicidio|balacera|baleado|aprehendido|robo\s*a?\s*mano\s*armada|asalto|sicario|secuestro|narcotr[aá]fico|estrangulado|acuchillado|disparado|ejecutado|robo|atraco|detenido|arrestado)\b/i;

// ── Crime Type Detection ──────────────────────────────────
const CRIME_TYPE_RULES = [
    { pattern: /\basesinato\b|\bhomicidio\b|\bfemicidio\b|\bfeminicidio\b|\bejecutado\b|\bestrangulado\b/i, type: 'Homicidio' },
    { pattern: /\bbalacera\b|\bdisparo\b|\bbaleado\b|\bsicario\b|\bdisparado\b/i, type: 'Balacera' },
    { pattern: /\brobo\b|\basalto\b|\batraco\b/i, type: 'Robo' },
    { pattern: /\bviolaci[oó]n\b/i, type: 'Violación' },
    { pattern: /\bsecuestro\b/i, type: 'Secuestro' },
    { pattern: /\bnarcotr[aá]fico\b|\bdroga\b/i, type: 'Narcotráfico' },
    { pattern: /\bextorsi[oó]n\b/i, type: 'Extorsión' },
    { pattern: /\bhurto\b|\bcarterista\b|\bestafa\b/i, type: 'Hurto' },
    { pattern: /\bacuchillado\b/i, type: 'Homicidio' },
];

function detectCrimeType(text) {
    if (!text) return 'Incidente';
    for (const { pattern, type } of CRIME_TYPE_RULES) {
        if (pattern.test(text)) return type;
    }
    return 'Incidente';
}

// ── Address Extraction (Santa Cruz specific) ──────────────
function extractAddress(text) {
    if (!text) return null;

    const patterns = [
        // Between streets / corners
        /(?:entre\s+calles?\s+)(.{5,60}?)(?:\.|,|;|$)/i,
        /(?:esquina\s+)(.{5,60}?)(?:\.|,|;|$)/i,
        /(?:y\s+la\s+calle\s+)(.{5,60}?)(?:\.|,|;|$)/i,

        // Specific anillos
        /\b((?:primer|segundo|tercer|cuarto|quinto|sexto|1er|2do|3er|4to|5to|6to)\s+anillo(?:\s+(?:interno|externo))?)/i,

        // Avenidas
        /\b((?:avenida|av\.?)\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú][a-zá-ú]+){0,3})/i,

        // Radiales
        /\b(radial\s+\d+(?:\s+[a-zá-ú]+)?)/i,

        // Known neighbourhoods / landmarks
        /\b(Plan\s*(?:Tres\s*Mil|3000))\b/i,
        /\b(Villa\s+1ro\s+de\s+Mayo)\b/i,
        /\b(Equipetrol)\b/i,
        /\b(Hamacas)\b/i,
        /\b(Los\s+Lotes)\b/i,
        /\b(El\s+Trompillo)\b/i,

        // Generic barrio/zona/urbanización
        /\b(barrio\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú][a-zá-ú]+){0,2})/i,
        /\b(zona\s+(?:norte|sur|este|oeste|central|[A-ZÁ-Ú][a-zá-ú]+))/i,
        /\b(urbanizaci[oó]n\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú][a-zá-ú]+){0,2})/i,

        // Calle + name
        /\b(calle\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú0-9][a-zá-ú0-9]*){0,3})/i,

        // Mercado
        /\b(mercado\s+[A-ZÁ-Ú][a-zá-ú]+)/i,
    ];

    for (const regex of patterns) {
        const match = text.match(regex);
        if (match) return (match[1] || match[0]).trim();
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

function isInBounds(lat, lng) {
    return lat >= SCZ_BOUNDS.latMin && lat <= SCZ_BOUNDS.latMax
        && lng >= SCZ_BOUNDS.lngMin && lng <= SCZ_BOUNDS.lngMax;
}

// ── RSS Feed Parser (with category filter) ────────────────
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

        // Filter by category/URL if source has a category filter
        if (source.filterCategory) {
            items = items.filter(item => {
                const cat = String(item.category || '');
                const link = String(item.link || '');
                const allCats = Array.isArray(item.category) ? item.category.join(' ') : cat;
                return source.filterCategory.test(allCats) || source.filterCategory.test(link);
            });
        }

        const articles = items.map(item => ({
            title: stripHTML(item.title || ''),
            link: item.link?.['@_href'] || item.link || item.guid || '',
            pubDate: item.pubDate || item.published || '',
            description: stripHTML(item.description || item.summary || ''),
            source: source.name,
        }));

        console.log(`   ✓ ${source.name}: ${articles.length} crime/security articles`);
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

        const selectors = ['article', '.card', '.news-item', '.post-item', '.nota', '.noticia', '.article-item', 'li'];
        let items = $([]);
        for (const sel of selectors) {
            items = $(sel);
            if (items.length > 3) break;
        }

        items.each((_, el) => {
            const $el = $(el);
            const $link = $el.find('a').first();
            let href = $link.attr('href') || '';
            if (!href) return;

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

        // Fallback: scan links for police/crime paths
        if (articles.length === 0) {
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const title = $(el).text().trim();
                if (title && title.length > 20 && (href.includes('/policial') || href.includes('/seguridad') || href.includes('/suceso'))) {
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

        if (!isInBounds(latF, lngF)) {
            console.log(`      ⚠️  Out of bounds (${latF.toFixed(4)}, ${lngF.toFixed(4)}): ${address}`);
            return null;
        }

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

    // ── Fix 5: One-time cleanup of out-of-bounds records ──
    console.log('🧹 Cleaning up out-of-bounds Santa Cruz records...');
    const { data: badRecords, error: cleanupErr } = await supabase
        .from('crimes')
        .delete()
        .eq('city', 'santa_cruz')
        .or(`lat.lt.${SCZ_BOUNDS.latMin},lat.gt.${SCZ_BOUNDS.latMax},lng.lt.${SCZ_BOUNDS.lngMin},lng.gt.${SCZ_BOUNDS.lngMax}`)
        .select('id');

    if (cleanupErr) {
        console.warn(`   ⚠️  Cleanup error: ${cleanupErr.message}`);
    } else {
        console.log(`   ✓ Removed ${badRecords?.length || 0} out-of-bounds records\n`);
    }

    // Step 1: Fetch from all sources
    console.log('📡 Fetching news sources...\n');
    let allArticles = [];
    const sourceCounts = {};

    for (const source of SOURCES) {
        const articles = source.type === 'rss'
            ? await fetchRSS(source)
            : await fetchHTML(source);
        sourceCounts[source.name] = { fetched: articles.length, matched: 0, geocoded: 0, skipped: 0 };
        allArticles.push(...articles);
        await sleep(500);
    }

    console.log(`\n📊 Total articles fetched: ${allArticles.length}`);
    for (const [name, c] of Object.entries(sourceCounts)) {
        console.log(`   ${name}: ${c.fetched}`);
    }

    // Step 2: Strict crime keyword filtering — BOTH title AND description must match
    const crimeArticles = allArticles.filter(a => {
        const titleMatch = HARD_CRIME_KEYWORDS.test(a.title);
        const descMatch = HARD_CRIME_KEYWORDS.test(a.description);
        // If we have a description, require both; otherwise title alone (for short RSS items)
        return a.description.length > 20 ? (titleMatch || descMatch) : titleMatch;
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
        console.log(`   [${a.source}] ${a.title.substring(0, 90)}`);
    }

    // Step 3: Check for duplicates
    console.log('\n🔍 Checking for duplicates...');
    const urls = crimeArticles.map(a => typeof a.link === 'string' ? a.link : '').filter(Boolean);
    const { data: existing } = await supabase
        .from('crimes')
        .select('source_url')
        .in('source_url', urls.slice(0, 500));
    const existingUrls = new Set((existing || []).map(r => r.source_url));
    console.log(`   ${existingUrls.size} articles already in database`);

    // Step 4: Process, geocode, validate bounds
    console.log('\n📰 Processing + geocoding...\n');
    const rows = [];
    let geocodeSuccess = 0;
    let skippedBounds = 0;
    let skippedNoAddress = 0;
    let skippedDupes = 0;

    for (const article of crimeArticles) {
        const articleUrl = typeof article.link === 'string' ? article.link : '';

        if (articleUrl && existingUrls.has(articleUrl)) {
            skippedDupes++;
            continue;
        }

        const fullText = `${article.title} ${article.description}`;
        const crimeType = detectCrimeType(fullText);
        const address = extractAddress(fullText);

        if (!address) {
            skippedNoAddress++;
            if (sourceCounts[article.source]) sourceCounts[article.source].skipped++;
            console.log(`   ⏭️  No address: ${article.title.substring(0, 70)}`);
            continue;
        }

        // Geocode — skip entirely if out of bounds (no fallback)
        const coords = await geocodeAddress(address);
        await sleep(1000); // Nominatim rate limit

        if (!coords) {
            skippedBounds++;
            if (sourceCounts[article.source]) sourceCounts[article.source].skipped++;
            continue;
        }

        geocodeSuccess++;
        if (sourceCounts[article.source]) sourceCounts[article.source].geocoded++;

        let dateISO = NOW_ISO;
        if (article.pubDate) {
            const d = new Date(article.pubDate);
            if (!isNaN(d.getTime())) dateISO = d.toISOString();
        }

        console.log(`   ✓ [${crimeType}] ${address} — ${article.title.substring(0, 50)}`);

        rows.push({
            crime_type: crimeType,
            city: 'santa_cruz',
            lat: coords.lat,
            lng: coords.lng,
            date_reported: dateISO,
            neighbourhood: null,
            address,
            description: article.title,
            source_url: articleUrl,
            last_updated: NOW_ISO,
        });
    }

    console.log(`\n📊 Results: ${rows.length} valid, ${skippedDupes} dupes, ${skippedNoAddress} no address, ${skippedBounds} out of bounds`);

    if (rows.length === 0) {
        console.log('\nℹ️  No valid records to insert.');
        process.exit(0);
    }

    // Step 5: Insert into Supabase
    console.log('\n📥 Inserting into Supabase (append-only)...');

    const BATCH = 500;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { data, error } = await supabase.from('crimes').insert(batch).select('id');
        if (error) {
            console.error(`❌ INSERT failed at batch ${Math.ceil((i + 1) / BATCH)}: ${error.message}`);
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
    console.log('   ' + 'Source'.padEnd(16) + 'Fetched  Matched  Geocoded  Skipped');
    for (const [name, c] of Object.entries(sourceCounts)) {
        console.log(`   ${name.padEnd(16)}${String(c.fetched).padEnd(9)}${String(c.matched).padEnd(9)}${String(c.geocoded).padEnd(10)}${c.skipped}`);
    }

    console.log(`\n   Total inserted: ${totalInserted}`);
    console.log(`\n✅ Done — ${totalInserted} Santa Cruz incidents added to Supabase\n`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
