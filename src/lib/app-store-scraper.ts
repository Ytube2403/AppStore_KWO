/**
 * App Store & Google Play scraper
 * Extracts app metadata from public store pages (no auth required)
 * Used by generate-profile/route.ts before feeding to Gemini
 */

export type AppInfo = {
    title: string
    description: string
    category: string
    appId: string
    store: 'appstore' | 'googleplay'
    country: string
}

/** Store type matching DB CHECK constraint on datasets.store */
export type DbStoreType = 'apple' | 'google_play'

/** Parse App Store ID & country from URL */
function parseAppStoreUrl(url: string): { appId: string; country: string } | null {
    // https://apps.apple.com/us/app/name/id123456789
    const match = url.match(/apps\.apple\.com\/([a-z]{2})\/app\/[^/]+\/id(\d+)/i)
    if (!match) return null
    return { country: match[1].toLowerCase(), appId: match[2] }
}

/** Parse Google Play package name & country from URL */
function parseGooglePlayUrl(url: string): { appId: string; country: string } | null {
    // https://play.google.com/store/apps/details?id=com.example.app&hl=en
    const match = url.match(/play\.google\.com\/store\/apps\/details\?.*id=([^&\s]+)/i)
    if (!match) return null
    const hlMatch = url.match(/[?&]hl=([a-z]{2})/i)
    return { appId: match[1], country: hlMatch ? hlMatch[1].toLowerCase() : 'us' }
}

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** Extract content between tags using simple string matching */
function extractMeta(html: string, name: string): string {
    // <meta name="..." content="..."> or <meta property="..." content="...">
    const patterns = [
        new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'),
        new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["']`, 'i'),
    ]
    for (const re of patterns) {
        const m = html.match(re)
        if (m?.[1]) return m[1].trim()
    }
    return ''
}

function extractJsonLd(html: string, key: string): string {
    const ldMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
    if (!ldMatch) return ''
    try {
        const obj = JSON.parse(ldMatch[1])
        return obj[key] || ''
    } catch {
        return ''
    }
}

/** Scrape Apple App Store page */
async function scrapeAppStore(url: string): Promise<AppInfo> {
    const parsed = parseAppStoreUrl(url)
    if (!parsed) throw new Error('Invalid App Store URL. Expected format: apps.apple.com/{country}/app/{name}/id{appId}')

    const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    })
    if (!res.ok) throw new Error(`App Store fetch failed: ${res.status} ${res.statusText}`)
    const html = await res.text()

    const title =
        extractJsonLd(html, 'name') ||
        extractMeta(html, 'og:title') ||
        (html.match(/<title>([^|<]+)/)?.[1] || '').trim()

    const description =
        extractJsonLd(html, 'description') ||
        extractMeta(html, 'og:description') ||
        extractMeta(html, 'description')

    const category =
        extractMeta(html, 'genre') ||
        (html.match(/applicationCategory[":\s]+"([^"]+)"/)?.[1] || '')

    return {
        title: title.replace(/ on the App Store$/, '').trim(),
        description: description.slice(0, 1500),
        category,
        appId: parsed.appId,
        store: 'appstore',
        country: parsed.country,
    }
}

/** Scrape Google Play page */
async function scrapeGooglePlay(url: string): Promise<AppInfo> {
    const parsed = parseGooglePlayUrl(url)
    if (!parsed) throw new Error('Invalid Google Play URL. Expected format: play.google.com/store/apps/details?id={packageName}')

    const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    })
    if (!res.ok) throw new Error(`Google Play fetch failed: ${res.status} ${res.statusText}`)
    const html = await res.text()

    const title = extractMeta(html, 'og:title') || ''
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description') || ''
    const category = extractMeta(html, 'genre') || ''

    return {
        title: title.trim(),
        description: description.slice(0, 1500),
        category,
        appId: parsed.appId,
        store: 'googleplay',
        country: parsed.country,
    }
}

/**
 * Main entry point. Detects store from URL and scrapes info.
 * Throws on invalid URL or fetch failure.
 */
export async function scrapeAppInfo(url: string): Promise<AppInfo> {
    const normalized = url.trim()

    if (normalized.includes('apps.apple.com')) {
        return scrapeAppStore(normalized)
    }
    if (normalized.includes('play.google.com')) {
        return scrapeGooglePlay(normalized)
    }
    throw new Error('URL must be from apps.apple.com or play.google.com')
}

/**
 * Extract a canonical App Store / Play ID + store + country from any URL.
 * Returns store as DbStoreType ('apple' | 'google_play') matching datasets.store CHECK constraint.
 * Returns null if URL is not recognized.
 */
export function parseStoreUrl(url: string): { appId: string; store: DbStoreType; country: string } | null {
    const apple = parseAppStoreUrl(url)
    if (apple) return { ...apple, store: 'apple' }
    const play = parseGooglePlayUrl(url)
    if (play) return { ...play, store: 'google_play' }
    return null
}
