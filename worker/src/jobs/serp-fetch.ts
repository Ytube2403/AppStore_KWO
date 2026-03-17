/**
 * SERP Fetch Job Handler
 * job_type = 'serp_fetch'
 * Fetches Apple App Store search results for each keyword and stores
 * the top-10 app list in serp_snapshots for use by the Clustering stage.
 */

import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import type { AnalysisJob } from '../types'

const CHUNK_SIZE = 20
const MIN_DELAY_MS = 2000
const MAX_DELAY_MS = 5000
const MAX_RETRIES_PER_KEYWORD = 3

type SerpApp = {
    appId: string
    name: string
    position: number
}

/** Randomized delay for stealth scraping */
function randomDelay(): Promise<void> {
    const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)
    return new Promise(resolve => setTimeout(resolve, ms))
}

/** Fetch Apple Search API for a keyword, return top-10 app IDs */
async function fetchSerpApps(keywordEn: string): Promise<SerpApp[]> {
    const encoded = encodeURIComponent(keywordEn)
    // Apple Search API (public endpoint, no auth required)
    const url = `https://itunes.apple.com/search?term=${encoded}&entity=software&limit=10&country=us`

    for (let attempt = 1; attempt <= MAX_RETRIES_PER_KEYWORD; attempt++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ASO-Worker/1.0)'
                },
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`SERP fetch HTTP ${res.status}`)

            const json = await res.json() as { results: any[] }
            return (json.results || []).map((app: any, idx: number) => ({
                appId: String(app.trackId || app.bundleId || ''),
                name: String(app.trackName || ''),
                position: idx + 1,
            })).filter(a => a.appId)
        } catch (err: any) {
            logger.warn(`SERP fetch attempt ${attempt}/${MAX_RETRIES_PER_KEYWORD} failed for "${keywordEn}": ${err.message}`)
            if (attempt < MAX_RETRIES_PER_KEYWORD) await randomDelay()
        }
    }
    return []
}

/** Update job progress in DB */
async function updateProgress(jobId: string, progressPercent: number) {
    await supabase
        .from('analysis_jobs')
        .update({ progress_percent: progressPercent })
        .eq('id', jobId)
}

/** Update run processed_keywords count */
async function updateRunProgress(runId: string, processedKeywords: number) {
    await supabase
        .from('intent_analysis_runs')
        .update({ processed_keywords: processedKeywords })
        .eq('id', runId)
}

export async function handleSerpFetchJob(job: AnalysisJob): Promise<void> {
    const { keyword_ids, run_id } = (job.payload || {}) as {
        keyword_ids: string[]
        run_id: string
    }

    if (!keyword_ids || keyword_ids.length === 0) {
        logger.warn(`[serp-fetch] Job ${job.id}: empty keyword_ids payload`)
        return
    }

    logger.info(`[serp-fetch] Job ${job.id}: processing ${keyword_ids.length} keywords (run=${run_id})`)

    // Fetch keyword data (we need keyword_en for search, or fallback to keyword)
    const { data: keywords, error: kwErr } = await supabase
        .from('keywords')
        .select('id, keyword, keyword_en')
        .in('id', keyword_ids)

    if (kwErr || !keywords) {
        throw new Error(`Failed to fetch keywords: ${kwErr?.message}`)
    }

    // Find already-fetched keywords to support resumability
    let alreadyFetched = new Set<string>()
    if (run_id) {
        const { data: existing } = await supabase
            .from('serp_snapshots')
            .select('keyword_id')
            .eq('run_id', run_id)

        alreadyFetched = new Set((existing || []).map(r => r.keyword_id))
        logger.info(`[serp-fetch] Job ${job.id}: ${alreadyFetched.size} keywords already fetched (resuming)`)
    }

    const remaining = keywords.filter(k => !alreadyFetched.has(k.id))
    const total = keywords.length
    let processed = alreadyFetched.size

    // Process in chunks of CHUNK_SIZE
    for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
        const chunk = remaining.slice(i, i + CHUNK_SIZE)

        for (const kw of chunk) {
            const searchTerm = kw.keyword_en || kw.keyword
            const apps = await fetchSerpApps(searchTerm)

            const snapshot = {
                keyword_id: kw.id,
                run_id: run_id || null,
                top_apps: apps,
                fetched_at: new Date().toISOString(),
            }

            const { error: insertErr } = await supabase
                .from('serp_snapshots')
                .upsert(snapshot, { onConflict: 'keyword_id,run_id' })

            if (insertErr) {
                logger.warn(`[serp-fetch] Failed to insert snapshot for kw=${kw.id}: ${insertErr.message}`)
            }

            processed++
            await randomDelay()
        }

        // Update progress after each chunk
        const progressPercent = Math.round((processed / total) * 100)
        await updateProgress(job.id, progressPercent)
        if (run_id) await updateRunProgress(run_id, processed)

        logger.info(`[serp-fetch] Job ${job.id}: ${processed}/${total} (${progressPercent}%)`)
    }

    // Mark run as completed
    if (run_id) {
        await supabase
            .from('intent_analysis_runs')
            .update({ status: 'completed', processed_keywords: total })
            .eq('id', run_id)
    }

    logger.info(`[serp-fetch] Job ${job.id}: completed successfully`)
}
