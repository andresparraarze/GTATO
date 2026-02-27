/**
 * GTATO — Santa Cruz de la Sierra Crime News Scraper
 *
 * Scrapes Bolivian news sites' police/crime sections via HTML (cheerio),
 * fetches each article's full body text for location extraction,
 * geocodes via Nominatim, and inserts into Supabase (append-only).
 *
 * Sources:
 *   1. El Deber — /tag/policial/ and /tag/policia/
 *   2. El Mundo — /policiales/
 *   3. Unitel — /policiales/
 *   4. Red Uno — /nota/policiales/
 *
 * CRITICAL: APPEND-ONLY. Never deletes user data.
 *           Deduplicates by source_url before insert.
 *           Cleans up out-of-bounds records on each run.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

// ── Supabase ──────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Config ────────────────────────────────────────────────
const DAYS_BACK = 30;
const NOW_ISO = new Date().toISOString();
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA = 'GTATO-CrimeMap/1.0';

const SCZ_BOUNDS = { latMin: -18.1, latMax: -17.5, lngMin: -63.5, lngMax: -62.8 };

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-BO,es;q=0.9,en;q=0.5',
};

// ── Source URLs ───────────────────────────────────────────
const SOURCES = [
    {
        name: 'El Deber', urls: [
            'https://eldeber.com.bo/tag/policial/',
            'https://eldeber.com.bo/tag/policia/',
        ]
    },
    { name: 'El Mundo', urls: ['https://elmundo.com.bo/policiales/'] },
    { name: 'Unitel', urls: ['https://unitel.bo/policiales/'] },
    { name: 'Red Uno', urls: ['https://www.reduno.com.bo/nota/policiales/'] },
];

// ── Crime Keywords (hard only) ────────────────────────────
const CRIME_KEYWORDS = /\b(asesinato|homicidio|femicidio|feminicidio|balacera|baleado|aprehendido|robo|asalto|atraco|sicario|secuestro|narcotr[aá]fico|estrangulado|acuchillado|disparado|ejecutado|detenido|arrestado|arma|droga|coca[ií]na)\b/i;

const CRIME_TYPE_RULES = [
    { pattern: /\basesinato\b|\bhomicidio\b|\bfemicidio\b|\bfeminicidio\b|\bejecutado\b|\bestrangulado\b/i, type: 'Homicidio' },
    { pattern: /\bbalacera\b|\bdisparo\b|\bbaleado\b|\bsicario\b|\bdisparado\b|\barma\b/i, type: 'Balacera' },
    { pattern: /\brobo\b|\basalto\b|\batraco\b/i, type: 'Robo' },
    { pattern: /\bviolaci[oó]n\b/i, type: 'Violación' },
    { pattern: /\bsecuestro\b/i, type: 'Secuestro' },
    { pattern: /\bnarcotr[aá]fico\b|\bdroga\b|\bcoca[ií]na\b/i, type: 'Narcotráfico' },
    { pattern: /\bextorsi[oó]n\b/i, type: 'Extorsión' },
    { pattern: /\bhurto\b|\bcarterista\b|\bestafa\b/i, type: 'Hurto' },
    { pattern: /\bacuchillado\b/i, type: 'Homicidio' },
];

function detectCrimeType(text) {
    for (const { pattern, type } of CRIME_TYPE_RULES) {
        if (pattern.test(text)) return type;
    }
    return 'Incidente';
}

// ── Address Extraction ────────────────────────────────────
function extractAddress(text) {
    if (!text) return null;
    const patterns = [
        /(?:entre\s+calles?\s+)(.{5,60}?)(?:\.|,|;|$)/i,
        /(?:esquina\s+)(.{5,60}?)(?:\.|,|;|$)/i,
        /(?:y\s+la\s+calle\s+)(.{5,60}?)(?:\.|,|;|$)/i,
        /\b((?:primer|segundo|tercer|cuarto|quinto|sexto|1er|2do|3er|4to|5to|6to)\s+anillo(?:\s+(?:interno|externo))?)/i,
        /\b((?:avenida|av\.?)\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú][a-zá-ú]+){0,3})/i,
        /\b(radial\s+\d+(?:\s+[a-zá-ú]+)?)/i,
        /\b(Plan\s*(?:Tres\s*Mil|3000))\b/i,
        /\b(Villa\s+1ro\s+de\s+Mayo)\b/i,
        /\b(Equipetrol)\b/i,
        /\b(Hamacas)\b/i,
        /\b(Los\s+Lotes)\b/i,
        /\b(El\s+Trompillo)\b/i,
        /\b(La\s+Guardia)\b/i,
        /\b(Montero)\b/i,
        /\b(Warnes)\b/i,
        /\b(barrio\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú][a-zá-ú]+){0,2})/i,
        /\b(zona\s+(?:norte|sur|este|oeste|central|[A-ZÁ-Ú][a-zá-ú]+))/i,
        /\b(urbanizaci[oó]n\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú][a-zá-ú]+){0,2})/i,
        /\b(calle\s+[A-ZÁ-Ú][a-zá-ú]+(?:\s+[A-ZÁ-Ú0-9][a-zá-ú0-9]*){0,3})/i,
        /\b(mercado\s+[A-ZÁ-Ú][a-zá-ú]+)/i,
    ];
    for (const regex of patterns) {
        const match = text.match(regex);
        if (match) return (match[1] || match[0]).trim();
    }
    return null;
}

// ── Helpers ───────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isInBounds(lat, lng) {
    return lat >= SCZ_BOUNDS.latMin && lat <= SCZ_BOUNDS.latMax
        && lng >= SCZ_BOUNDS.lngMin && lng <= SCZ_BOUNDS.lngMax;
}

async function fetchPage(url) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

// ── Scrape Listing Page ───────────────────────────────────
async function scrapeListingPage(url, sourceName) {
    console.log(`      📄 ${url}`);
    try {
        const html = await fetchPage(url);
        const $ = cheerio.load(html);
        const articles = [];
        const seen = new Set();

        // Try article tags first, then generic card-like selectors
        const selectors = ['article', '.card', '.news-item', '.post-item', '.nota', '.noticia', '.article-card', '.entry'];
        let items = $([]);
        for (const sel of selectors) {
            items = $(sel);
            if (items.length > 2) break;
        }

        items.each((_, el) => {
            const $el = $(el);
            const $link = $el.find('a[href]').first();
            let href = $link.attr('href') || '';
            if (!href) return;

            // Make absolute
            if (href.startsWith('/')) {
                const base = new URL(url);
                href = `${base.origin}${href}`;
            } else if (!href.startsWith('http')) return;

            if (seen.has(href)) return;
            seen.add(href);

            const title = $link.text().trim()
                || $el.find('h2, h3, h4, .title, .headline').first().text().trim()
                || '';
            if (!title || title.length < 15) return;

            const dateText = $el.find('time, .date, .fecha, [datetime]').first().text().trim()
                || $el.find('[datetime]').first().attr('datetime') || '';

            articles.push({ title: title.substring(0, 300), link: href, pubDate: dateText, source: sourceName });
        });

        // Fallback: scan all meaningful links
        if (articles.length === 0) {
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const title = $(el).text().trim();
                if (!title || title.length < 20) return;
                if (seen.has(href)) return;

                let fullUrl = href;
                if (href.startsWith('/')) {
                    fullUrl = `${new URL(url).origin}${href}`;
                } else if (!href.startsWith('http')) return;

                // Only include links that look like articles
                if (fullUrl.includes('/nota/') || fullUrl.includes('/policial') || fullUrl.includes('/seguridad')
                    || fullUrl.includes('/tag/') || /\/\d{4}\//.test(fullUrl)) {
                    seen.add(href);
                    articles.push({ title: title.substring(0, 300), link: fullUrl, pubDate: '', source: sourceName });
                }
            });
        }

        return articles;
    } catch (err) {
        console.warn(`      ⚠️  Failed: ${err.message}`);
        return [];
    }
}

// ── Fetch Article Full Body ───────────────────────────────
async function fetchArticleBody(url) {
    try {
        const html = await fetchPage(url);
        const $ = cheerio.load(html);
        const bodyText = $('article, .content, .post-content, .entry-content, .article-body, .nota-contenido, .cuerpo, main')
            .first().text().trim()
            || $('p').map((_, el) => $(el).text()).get().join(' ');
        return bodyText.substring(0, 3000);
    } catch {
        return '';
    }
}

// ── Geocode ───────────────────────────────────────────────
async function geocodeAddress(address) {
    const query = `${address}, Santa Cruz de la Sierra, Bolivia`;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_UA } });
        if (!res.ok) return null;
        const results = await res.json();
        if (results.length === 0) return null;
        const lat = parseFloat(results[0].lat);
        const lng = parseFloat(results[0].lon);
        if (!isInBounds(lat, lng)) {
            console.log(`         ⚠️  Out of bounds (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
            return null;
        }
        console.log(`         📍 → (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        return { lat, lng };
    } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────
async function main() {
    console.log('\n🚔 GTATO — Santa Cruz de la Sierra Crime Scraper');
    console.log(`📅 Last ${DAYS_BACK} days | APPEND-ONLY mode\n`);

    // Cleanup out-of-bounds records
    console.log('🧹 Cleaning up out-of-bounds records...');
    const { data: cleaned } = await supabase
        .from('crimes').delete().eq('city', 'santa_cruz')
        .or(`lat.lt.${SCZ_BOUNDS.latMin},lat.gt.${SCZ_BOUNDS.latMax},lng.lt.${SCZ_BOUNDS.lngMin},lng.gt.${SCZ_BOUNDS.lngMax}`)
        .select('id');
    console.log(`   ✓ Removed ${cleaned?.length || 0} bad records\n`);

    // Step 1: Scrape listing pages from all sources
    console.log('📡 Scraping listing pages...\n');
    let allArticles = [];
    const stats = {};

    for (const source of SOURCES) {
        console.log(`   🔎 ${source.name}:`);
        stats[source.name] = { found: 0, matched: 0, geocoded: 0, inserted: 0, skipped: 0 };
        for (const url of source.urls) {
            const articles = await scrapeListingPage(url, source.name);
            allArticles.push(...articles);
            stats[source.name].found += articles.length;
            await sleep(500);
        }
        console.log(`      → ${stats[source.name].found} articles found\n`);
    }

    // Deduplicate by URL across sources
    const seenUrls = new Set();
    allArticles = allArticles.filter(a => {
        if (seenUrls.has(a.link)) return false;
        seenUrls.add(a.link);
        return true;
    });

    console.log(`📊 Total unique articles: ${allArticles.length}`);

    if (allArticles.length === 0) {
        console.log('\nℹ️  No articles found. Exiting.');
        process.exit(0);
    }

    // Step 2: Check which URLs already exist in Supabase
    console.log('\n🔍 Checking for duplicates in database...');
    const urls = allArticles.map(a => a.link).filter(Boolean);
    const { data: existing } = await supabase
        .from('crimes').select('source_url').in('source_url', urls.slice(0, 500));
    const existingUrls = new Set((existing || []).map(r => r.source_url));
    console.log(`   ${existingUrls.size} already in database`);

    const newArticles = allArticles.filter(a => !existingUrls.has(a.link));
    console.log(`   ${newArticles.length} new articles to process`);

    if (newArticles.length === 0) {
        console.log('\nℹ️  No new articles. Everything up to date.');
        process.exit(0);
    }

    // Step 3: For each new article, fetch full body, check crime keywords, extract location, geocode
    console.log('\n📰 Fetching article bodies + processing...\n');
    const rows = [];
    let geocodeSuccess = 0, skippedKeyword = 0, skippedNoAddr = 0, skippedBounds = 0;

    for (const article of newArticles) {
        // Fetch full body text
        const bodyText = await fetchArticleBody(article.link);
        const fullText = `${article.title} ${bodyText}`;
        await sleep(300);

        // Check crime keywords
        if (!CRIME_KEYWORDS.test(fullText)) {
            skippedKeyword++;
            stats[article.source].skipped++;
            continue;
        }

        stats[article.source].matched++;
        const crimeType = detectCrimeType(fullText);
        const address = extractAddress(fullText);

        if (!address) {
            skippedNoAddr++;
            console.log(`   ⏭️  No address: ${article.title.substring(0, 65)}`);
            continue;
        }

        // Geocode (skip if out of bounds — no fallback)
        console.log(`   🌍 [${crimeType}] ${address}`);
        const coords = await geocodeAddress(address);
        await sleep(1000);

        if (!coords) {
            skippedBounds++;
            continue;
        }

        geocodeSuccess++;
        stats[article.source].geocoded++;

        let dateISO = NOW_ISO;
        if (article.pubDate) {
            const d = new Date(article.pubDate);
            if (!isNaN(d.getTime())) dateISO = d.toISOString();
        }

        rows.push({
            crime_type: crimeType,
            city: 'santa_cruz',
            lat: coords.lat,
            lng: coords.lng,
            date_reported: dateISO,
            neighbourhood: null,
            address,
            description: article.title,
            source_url: article.link,
            last_updated: NOW_ISO,
        });
    }

    console.log(`\n📊 Processing results:`);
    console.log(`   Valid records:     ${rows.length}`);
    console.log(`   No crime keyword:  ${skippedKeyword}`);
    console.log(`   No address:        ${skippedNoAddr}`);
    console.log(`   Out of bounds:     ${skippedBounds}`);
    console.log(`   Geocoded in SCZ:   ${geocodeSuccess}`);

    if (rows.length === 0) {
        console.log('\nℹ️  No valid records to insert.');
        process.exit(0);
    }

    // Step 4: Insert into Supabase (append-only)
    console.log('\n📥 Inserting into Supabase...');
    const BATCH = 500;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { data, error } = await supabase.from('crimes').insert(batch).select('id');
        if (error) {
            console.error(`   ❌ Batch ${Math.ceil((i + 1) / BATCH)} failed: ${error.message}`);
            continue;
        }
        totalInserted += data.length;
        // Track per-source insertions
        batch.forEach(r => {
            const src = newArticles.find(a => a.link === r.source_url)?.source;
            if (src && stats[src]) stats[src].inserted++;
        });
        console.log(`   ✓ Batch ${Math.ceil((i + 1) / BATCH)}: ${data.length} rows`);
    }

    // Summary
    console.log('\n' + '─'.repeat(60));
    console.log('📋 SUMMARY');
    console.log('─'.repeat(60));

    const typeCounts = {};
    rows.forEach(r => { typeCounts[r.crime_type] = (typeCounts[r.crime_type] || 0) + 1; });

    console.log('\n   Crime type breakdown:');
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`      ${t}: ${c}`));

    console.log('\n   Per-source breakdown:');
    console.log('   ' + 'Source'.padEnd(16) + 'Found    Matched  Geocoded  Inserted  Skipped');
    for (const [name, s] of Object.entries(stats)) {
        console.log(`   ${name.padEnd(16)}${String(s.found).padEnd(9)}${String(s.matched).padEnd(9)}${String(s.geocoded).padEnd(10)}${String(s.inserted).padEnd(10)}${s.skipped}`);
    }

    console.log(`\n   Total inserted: ${totalInserted}`);
    console.log(`\n✅ Done — ${totalInserted} Santa Cruz incidents added\n`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
