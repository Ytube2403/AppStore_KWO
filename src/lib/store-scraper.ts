/**
 * Store Scraper — Generic
 * Extracts app metadata from public store pages (no auth required).
 * Used by generate-profile/route.ts before feeding to Gemini.
 *
 * Currently supported:
 *   ✅ Google Play  (google-play-scraper npm package)
 *   ⏸  Apple App Store — temporarily disabled, see scrapeAppleStore() below
 */

export type AppInfo = {
    title: string
    description: string
    category: string
    appId: string
    store: 'googleplay' // | 'appstore' — re-add when Apple is re-enabled
    country: string
}

/** Store type matching DB CHECK constraint on datasets.store */
export type DbStoreType = 'google_play' // | 'apple' — re-add when Apple is re-enabled

// ─── URL Parsers ────────────────────────────────────────────────────────────

/** Parse Google Play package name & country from URL */
function parseGooglePlayUrl(url: string): { appId: string; country: string } | null {
    // https://play.google.com/store/apps/details?id=com.example.app&hl=en
    const match = url.match(/play\.google\.com\/store\/apps\/details\?.*id=([^&\s]+)/i)
    if (!match) return null
    const hlMatch = url.match(/[?&]hl=([a-z]{2})/i)
    return { appId: match[1], country: hlMatch ? hlMatch[1].toLowerCase() : 'us' }
}

// ─── Google Play Scraper ────────────────────────────────────────────────────

async function scrapeGooglePlay(url: string): Promise<AppInfo> {
    const parsed = parseGooglePlayUrl(url)
    if (!parsed) {
        throw new Error(
            'Invalid Google Play URL. Expected format: play.google.com/store/apps/details?id={packageName}'
        )
    }

    // Dynamic import avoids bundling in non-worker environments
    // (google-play-scraper is a Node.js-only package)
    const gplay = (await import('google-play-scraper')).default

    const app = await (gplay as any).app({
        appId: parsed.appId,
        lang: 'en',
        country: parsed.country || 'us',
    }) as any

    return {
        title: String(app.title || '').trim(),
        description: String(app.description || app.summary || '').slice(0, 1500),
        category: String(app.genre || app.genreId || ''),
        appId: parsed.appId,
        store: 'googleplay',
        country: parsed.country,
    }
}

// ─── Apple App Store — Disabled ─────────────────────────────────────────────
//
// Apple App Store scraping is temporarily disabled due to rate limiting issues.
// To re-enable: uncomment the block below, add 'appstore' back to AppInfo.store
// union type, add 'apple' back to DbStoreType, and add the apple branch in
// scrapeAppInfo() + parseStoreUrl().
//
// async function scrapeAppleStore(url: string): Promise<AppInfo> {
//     const match = url.match(/apps\.apple\.com\/([a-z]{2})\/app\/[^/]+\/id(\d+)/i)
//     if (!match) throw new Error('Invalid App Store URL')
//     const storeLib = (await import('app-store-scraper')).default
//     const app = await (storeLib as any).app({ id: match[2], country: match[1], lang: 'en-us' })
//     return {
//         title: String(app.title || '').trim(),
//         description: String(app.description || '').slice(0, 1500),
//         category: String(app.genre || ''),
//         appId: match[2],
//         store: 'appstore',
//         country: match[1].toLowerCase(),
//     }
// }

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Detect store from URL and scrape app metadata.
 * Throws on unsupported URL or fetch failure.
 */
export async function scrapeAppInfo(url: string): Promise<AppInfo> {
    const normalized = url.trim()

    if (normalized.includes('play.google.com')) {
        return scrapeGooglePlay(normalized)
    }

    // Apple temporarily disabled
    if (normalized.includes('apps.apple.com')) {
        throw new Error(
            'Apple App Store scraping is temporarily disabled. Please use a Google Play URL instead.'
        )
    }

    throw new Error('URL must be from play.google.com (Apple App Store support coming soon)')
}

/**
 * Extract a canonical App Store / Play ID + store + country from any URL.
 * Returns store as DbStoreType matching datasets.store CHECK constraint.
 * Returns null if URL is not recognized.
 */
export function parseStoreUrl(url: string): { appId: string; store: DbStoreType; country: string } | null {
    const play = parseGooglePlayUrl(url)
    if (play) return { ...play, store: 'google_play' }

    // Apple disabled — return null so caller gets 'unsupported URL' error
    // const apple = parseAppleStoreUrl(url)
    // if (apple) return { ...apple, store: 'apple' }

    return null
}
