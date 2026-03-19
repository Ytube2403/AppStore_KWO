/**
 * SERP Fetch Job Handler
 * job_type = 'serp_fetch'
 *
 * Fetches top-10 search results for each keyword from the store:
 *   ✅ 'google_play' → google-play-scraper (.search)
 *   ⏸  'apple'       → temporarily disabled (rate limiting issues)
 *
 * The store is determined from the dataset record (datasets.store column).
 * Results are stored in serp_snapshots for use by the Clustering stage.
 */

import gplay from 'google-play-scraper'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import type { AnalysisJob } from '../types'

type StoreType = 'apple' | 'google_play'

// Google Play: concurrency 3, delay 500ms — no significant rate limiting
const CONCURRENCY = 3
const BATCH_DELAY_MS = 500
const MAX_RETRIES = 3

// Apple App Store: temporarily disabled
// const APPLE_CONCURRENCY = 1
// const APPLE_DELAY_MS = 1500

type SerpApp = {
    appId: string
    name: string
    position: number
    score?: number
    free?: boolean
    developer?: string
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
}

// ── Apple App Store SERP — Temporarily Disabled ─────────────────────────────
//
// Disabled due to rate limiting on iTunes Search API.
// To re-enable: uncomment this function + update fetchSerp() below.
//
// async function fetchAppleSerp(term: string, country: string): Promise<SerpApp[]> {
//     for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
//         try {
//             const storeLib = (await import('app-store-scraper')).default
//             const results = await (storeLib as any).search({
//                 term, num: 10, country: country || 'us', lang: 'en-us',
//             }) as any[]
//             return results.map((app, idx) => ({
//                 appId: String(app.appId || app.id || ''),
//                 name:  String(app.title || ''),
//                 position: idx + 1,
//                 score: app.score, free: app.free, developer: app.developer,
//             })).filter(a => a.appId)
//         } catch (err: any) {
//             const errStr = err?.message ?? JSON.stringify(err)
//             logger.warn(`[serp] Apple attempt ${attempt}/3 failed for "${term}": ${errStr}`)
//             if (attempt < 3) await sleep(2000 * attempt)
//         }
//     }
//     logger.error(`[serp] Apple exhausted all retries for "${term}" — returning empty`)
//     return []
// }

/** Fetch Google Play SERP via google-play-scraper */
async function fetchGplaySerp(term: string, country: string): Promise<SerpApp[]> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const results = await gplay.search({
                term,
                num: 10,
                lang: 'en',
                country: country || 'us',
                fullDetail: false,
                price: 'all',
            }) as any[]
            return results.map((app, idx) => ({
                appId: String(app.appId || ''),
                name: String(app.title || ''),
                position: idx + 1,
                score: app.score,
                free: app.free,
                developer: app.developer,
            })).filter(a => a.appId)
        } catch (err: any) {
            logger.warn(`[serp] GPlay attempt ${attempt}/${MAX_RETRIES} failed for "${term}": ${err.message}`)
            if (attempt < MAX_RETRIES) await sleep(500 * attempt)
        }
    }
    return []
}

/** Dispatch SERP fetch to the correct store scraper */
async function fetchSerp(term: string, storeType: StoreType, country: string): Promise<SerpApp[]> {
    if (storeType === 'google_play') {
        return fetchGplaySerp(term, country)
    }
    // Apple temporarily disabled
    logger.warn(`[serp] Apple App Store is disabled. Skipping "${term}". Use a Google Play dataset.`)
    return []
}

async function updateProgress(jobId: string, progressPercent: number) {
    await supabase
        .from('analysis_jobs')
        .update({ progress_percent: progressPercent })
        .eq('id', jobId)
}

async function updateRunProgress(runId: string, processedKeywords: number) {
    await supabase
        .from('intent_analysis_runs')
        .update({ processed_keywords: processedKeywords })
        .eq('id', runId)
}

export async function handleSerpFetchJob(job: AnalysisJob): Promise<void> {
    const { keyword_ids, run_id, dataset_id } = (job.payload || {}) as {
        keyword_ids: string[]
        run_id: string
        dataset_id: string
    }

    if (!keyword_ids || keyword_ids.length === 0) {
        logger.warn(`[serp-fetch] Job ${job.id}: empty keyword_ids payload`)
        return
    }

    // ── 1. Resolve store type + country from the dataset ─────────────────────
    const resolvedDatasetId = dataset_id || job.dataset_id
    let storeType: StoreType = 'apple'
    let countryCode = 'us'

    if (resolvedDatasetId) {
        const { data: ds } = await supabase
            .from('datasets')
            .select('store, country_code')
            .eq('id', resolvedDatasetId)
            .single()

        if (ds) {
            storeType = (ds.store as StoreType) || 'apple'
            countryCode = ds.country_code || 'us'
        }
    }

    logger.info(
        `[serp-fetch] Job ${job.id}: ${keyword_ids.length} keywords | store=${storeType} | country=${countryCode} | run=${run_id} | concurrency=${CONCURRENCY}`
    )

    // ── 2. Fetch keyword text from DB ─────────────────────────────────────────
    const { data: keywords, error: kwErr } = await supabase
        .from('keywords')
        .select('id, keyword, keyword_en')
        .in('id', keyword_ids)

    if (kwErr || !keywords) {
        throw new Error(`Failed to fetch keywords: ${kwErr?.message}`)
    }

    // ── 3. Resume support: skip already-fetched keywords ──────────────────────
    let alreadyFetched = new Set<string>()
    if (run_id) {
        const { data: existing } = await supabase
            .from('serp_snapshots')
            .select('keyword_id')
            .eq('run_id', run_id)

        alreadyFetched = new Set((existing || []).map(r => r.keyword_id))
        if (alreadyFetched.size > 0) {
            logger.info(`[serp-fetch] Resuming: ${alreadyFetched.size} keywords already done`)
        }
    }

    const remaining = keywords.filter(k => !alreadyFetched.has(k.id))
    const total = keywords.length
    let processed = alreadyFetched.size

    // ── 4. Process in parallel batches ────────────────────────────────────────
    for (let i = 0; i < remaining.length; i += CONCURRENCY) {
        const batch = remaining.slice(i, i + CONCURRENCY)

        const results = await Promise.allSettled(
            batch.map(async (kw) => {
                const term = kw.keyword_en || kw.keyword
                const apps = await fetchSerp(term, storeType, countryCode)
                return { kw, apps }
            })
        )

        // Collect successful snapshots and batch-upsert
        const now = new Date().toISOString()
        const snapshots = results
            .filter((r): r is PromiseFulfilledResult<{ kw: typeof batch[0]; apps: SerpApp[] }> =>
                r.status === 'fulfilled')
            .map(r => ({
                keyword_id: r.value.kw.id,
                dataset_id: resolvedDatasetId,   // NOT NULL — required!
                run_id: run_id || null,
                store: storeType,
                top_apps: r.value.apps,
                snapshot_data: {},
                fetched_at: now,
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            }))

        if (snapshots.length > 0) {
            // Use INSERT ... ON CONFLICT DO UPDATE since partial unique index
            // (WHERE run_id IS NOT NULL) may not be honoured by Supabase upsert.
            // Instead: delete old rows for this (keyword_id, run_id) pair then insert fresh.
            const kwIds = snapshots.map(s => s.keyword_id)
            if (run_id) {
                await supabase
                    .from('serp_snapshots')
                    .delete()
                    .in('keyword_id', kwIds)
                    .eq('run_id', run_id)
            }
            const { error: insertErr } = await supabase
                .from('serp_snapshots')
                .insert(snapshots)

            if (insertErr) {
                logger.warn(`[serp-fetch] Batch insert error: ${insertErr.message}`)
            }
        }

        results
            .filter(r => r.status === 'rejected')
            .forEach(r => r.status === 'rejected' &&
                logger.warn(`[serp-fetch] Keyword failed: ${r.reason}`)
            )

        processed += batch.length
        const pct = Math.round((processed / total) * 100)

        await updateProgress(job.id, pct)
        if (run_id) await updateRunProgress(run_id, processed)

        logger.info(`[serp-fetch] ${processed}/${total} (${pct}%) — store=${storeType}`)

        if (i + CONCURRENCY < remaining.length) {
            await sleep(BATCH_DELAY_MS)
        }
    }

    // NOTE: Do NOT mark run as 'completed' here.
    // The run lifecycle is:  running → (serp_fetch done) → running → (clustering done) → completed
    // Only clustering.ts sets status='completed'.
    // We just ensure processed_keywords is up-to-date.
    logger.info(`[serp-fetch] Job ${job.id}: done — ${total} keywords from ${storeType}`)
}
