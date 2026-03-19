/**
 * Intent Analysis Job Handler
 * job_type = 'intent_analysis'
 *
 * OPTIMIZED: Batch-classifies 15 keywords per OpenRouter call instead of 1.
 * For 150 keywords: ~10 API calls instead of 150 → ~10x faster.
 *
 * Writes results to keyword_intent_results.
 */

import OpenAI from 'openai'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import type { AnalysisJob } from '../types'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
// ── Model tier: free vs premium ────────────────────────────────────────────
const FREE_MODEL  = process.env.OPENROUTER_FREE_MODEL  || 'minimax/minimax-m2.5:free'
const PREMIUM_MODEL = process.env.OPENROUTER_PREMIUM_MODEL || 'minimax/minimax-m2.5:free'

function resolveModel(tier?: string): string {
    return tier === 'premium' ? PREMIUM_MODEL : FREE_MODEL
}

const BATCH_SIZE = 15          // keywords per API call
const PARALLEL_BATCHES = 1     // sequential to avoid rate limits on free tier

type IntentType = 'core_feature' | 'feature_variant' | 'problem_solving' | 'discovery' | 'brand_competitor' | 'category' | 'adjacent' | 'unrelated'

interface IntentResult {
    keyword: string
    primary_intent: IntentType
    sub_intent: string
    intent_score: number
}

interface AppProfile {
    title: string
    category: string
    primary_use_cases: string[]
    negative_intents: string[]
}

function createOpenRouterClient(apiKey: string): OpenAI {
    return new OpenAI({
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        defaultHeaders: {
            'HTTP-Referer': 'https://aso-keyword-optimization.app',
            'X-Title': 'ASO Keyword Optimization Worker',
        },
    })
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
}

/**
 * Wrap classifyBatch with exponential backoff retry.
 * Retries up to maxRetries times on 429 (rate limit) or 5xx (server error).
 * Respects `retry-after` header on 429 responses.
 * Falls back to 'discovery' only after all retries are exhausted.
 */
async function classifyBatchWithRetry(
    items: Array<{ keyword: string; topApps: Array<{ name: string; position: number }> }>,
    appProfile: AppProfile,
    client: OpenAI,
    model: string,
    maxRetries = 3,
): Promise<IntentResult[]> {
    let lastError: any
    let currentModel = model
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await classifyBatch(items, appProfile, client, currentModel)
        } catch (err: any) {
            lastError = err
            const status = err?.status ?? err?.response?.status ?? 0
            const isRateLimit = status === 429 || String(err?.message).includes('429')
            const isServerError = status >= 500

            // Don't retry on non-transient errors (auth, bad request, parse error handled inside classifyBatch)
            if (!isRateLimit && !isServerError) {
                break
            }

            // ── Auto-fallback: if free model hit 429, switch to premium ──
            if (isRateLimit && currentModel !== PREMIUM_MODEL) {
                logger.warn(
                    `[intent-analysis] Free model rate-limited (429) — falling back to premium model: ${PREMIUM_MODEL}`
                )
                currentModel = PREMIUM_MODEL
                // Retry immediately with premium model (no wait needed)
                continue
            }

            let waitMs: number
            if (isRateLimit) {
                // Respect Retry-After header if available, otherwise 30s
                const retryAfterHeader =
                    err?.headers?.['retry-after'] ||
                    err?.response?.headers?.['retry-after']
                waitMs = retryAfterHeader
                    ? parseInt(String(retryAfterHeader), 10) * 1000
                    : 30_000
            } else {
                // Exponential backoff: 2s, 4s, 8s
                waitMs = Math.pow(2, attempt + 1) * 1000
            }

            logger.warn(
                `[intent-analysis] Batch retry ${attempt + 1}/${maxRetries} ` +
                `(status=${status}, model=${currentModel}, wait=${waitMs}ms): ${err?.message}`
            )
            await sleep(waitMs)
        }
    }
    // All retries exhausted — fallback to discovery
    logger.warn(`[intent-analysis] Batch permanently failed after ${maxRetries} retries: ${lastError?.message}`)
    return items.map(item => ({
        keyword: item.keyword,
        primary_intent: 'discovery' as IntentType,
        sub_intent: 'api error',
        intent_score: 40,
    }))
}

/**
 * Classify a BATCH of keywords in a single OpenRouter call.
 * Returns an array aligned with the input keywords array.
 */
async function classifyBatch(
    items: Array<{ keyword: string; topApps: Array<{ name: string; position: number }> }>,
    appProfile: AppProfile,
    client: OpenAI,
    model: string,
): Promise<IntentResult[]> {
    const appContext = `Target app: "${appProfile.title}" (${appProfile.category})
Core use cases: ${appProfile.primary_use_cases.join(', ')}
NOT relevant: ${appProfile.negative_intents.join(', ')}`

    const itemsText = items.map((item, i) => {
        const top3 = item.topApps
            .sort((a, b) => a.position - b.position)
            .slice(0, 3)
            .map(a => a.name)
            .join(', ')
        return `${i + 1}. keyword="${item.keyword}" top_apps=[${top3 || 'none'}]`
    }).join('\n')

    const prompt = `You are an ASO (App Store Optimization) expert. Classify each keyword's search intent relative to the target app.

${appContext}

Keywords to classify:
${itemsText}

Classify each keyword into EXACTLY ONE of these 8 intent types:
- core_feature: Directly describes the app's primary functionality. Top SERP results are the same type of app. (score 80-100)
- feature_variant: A specific feature, use-case, or variation of what the app does (e.g., "photo collage" for a photo editor). (score 65-90)
- problem_solving: Describes a problem or pain point the app solves (e.g., "clean storage fast", "remove red eyes"). (score 60-85)
- discovery: Broad/exploratory queries where user is browsing options (e.g., "best photo apps", "top games 2025"). (score 40-70)
- brand_competitor: Contains a brand name — either the target app or a direct competitor. (score 30-60)
- category: Generic category or genre term (e.g., "photography", "utilities", "puzzle game"). (score 35-65)
- adjacent: Related to a nearby category but NOT what the app primarily does (e.g., "video editor" for a photo app). (score 25-55)
- unrelated: No meaningful connection to the app's purpose. (score 0-25)

Return ONLY a valid JSON array, one object per keyword, in the SAME order:
[{"keyword":"...","primary_intent":"core_feature|feature_variant|problem_solving|discovery|brand_competitor|category|adjacent|unrelated","sub_intent":"2-4 word descriptive phrase","intent_score":0-100}]`

    const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1500,
    })

    const raw = (response.choices[0]?.message?.content || '')
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()

    let results: IntentResult[]
    try {
        results = JSON.parse(raw)
    } catch {
        // JSON parse failed — return fallback for all
        logger.warn(`[intent-analysis] JSON parse failed, using fallback for batch of ${items.length}`)
        return items.map(item => ({
            keyword: item.keyword,
            primary_intent: 'discovery' as IntentType,
            sub_intent: 'parse error',
            intent_score: 40,
        }))
    }

    // Validate length — pad with fallbacks if needed
    const validTypes: IntentType[] = ['core_feature', 'feature_variant', 'problem_solving', 'discovery', 'brand_competitor', 'category', 'adjacent', 'unrelated']
    const normalized = items.map((item, i) => {
        const r = results[i] || {}
        const intent = validTypes.includes(r.primary_intent as IntentType) ? r.primary_intent as IntentType : 'discovery'
        return {
            keyword: item.keyword,
            primary_intent: intent,
            sub_intent: String(r.sub_intent || '').slice(0, 60) || 'unknown',
            intent_score: Math.max(0, Math.min(100, Number(r.intent_score) || 50)),
        }
    })

    return normalized
}

async function updateJobProgress(jobId: string, percent: number) {
    await supabase
        .from('analysis_jobs')
        .update({ progress_percent: percent })
        .eq('id', jobId)
}

export async function handleIntentAnalysisJob(job: AnalysisJob): Promise<void> {
    const { keyword_ids, run_id, dataset_id, model_tier } = job.payload as {
        keyword_ids: string[]
        run_id: string
        dataset_id: string
        model_tier?: string
    }
    const selectedModel = resolveModel(model_tier)

    if (!keyword_ids || keyword_ids.length === 0) {
        logger.warn(`[intent-analysis] Job ${job.id}: empty keyword_ids`)
        return
    }

    // ── Guard: wait for serp_fetch to complete ─────────────────────────────────
    // serp_fetch has priority 5, intent_analysis has priority 6.
    // Under normal single-worker operation priority ordering prevents this.
    // This guard handles the edge case of multi-worker or manual queue injection.
    if (run_id) {
        const { data: serpJob } = await supabase
            .from('analysis_jobs')
            .select('id, status')
            .eq('job_type', 'serp_fetch')
            .contains('payload', { run_id })
            .maybeSingle()

        if (serpJob && serpJob.status !== 'completed') {
            throw new Error(
                `[intent-analysis] serp_fetch (${serpJob.id}) not completed yet (status=${serpJob.status}) — will retry`
            )
        }
    }

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

    logger.info(`[intent-analysis] Job ${job.id}: ${keyword_ids.length} keywords | model=${selectedModel} (tier=${model_tier ?? 'free'}) | batch=${BATCH_SIZE} | parallel=${PARALLEL_BATCHES}`)


    // ── Load dataset target_app_profile ────────────────────────────────────────
    const { data: dataset, error: dsErr } = await supabase
        .from('datasets')
        .select('target_app_profile')
        .eq('id', dataset_id)
        .single()

    if (dsErr || !dataset?.target_app_profile) {
        throw new Error(`Dataset ${dataset_id} has no target_app_profile — run Generate Profile first`)
    }
    const appProfile = dataset.target_app_profile as AppProfile

    // ── Load keywords ──────────────────────────────────────────────────────────
    const { data: keywords, error: kwErr } = await supabase
        .from('keywords')
        .select('id, keyword, keyword_en')
        .in('id', keyword_ids)

    if (kwErr || !keywords) {
        throw new Error(`Failed to fetch keywords: ${kwErr?.message}`)
    }

    // ── Load SERP snapshots ────────────────────────────────────────────────────
    const { data: snapshotRows } = await supabase
        .from('serp_snapshots')
        .select('keyword_id, top_apps')
        .eq('run_id', run_id)

    const serpMap = new Map<string, Array<{ appId: string; name: string; position: number }>>()
    for (const row of (snapshotRows || [])) {
        serpMap.set(row.keyword_id, row.top_apps || [])
    }

    if (serpMap.size === 0) {
        logger.warn(`[intent-analysis] No SERP snapshots found for run ${run_id} — all keywords will default to discovery`)
    } else {
        logger.info(`[intent-analysis] Loaded ${serpMap.size} SERP snapshots`)
    }

    // ── Skip already-processed keywords (resume support) ──────────────────────
    const { data: existing } = await supabase
        .from('keyword_intent_results')
        .select('keyword_id')
        .eq('run_id', run_id)

    const alreadyDone = new Set((existing || []).map(r => r.keyword_id))
    const remaining = keywords.filter(k => !alreadyDone.has(k.id))

    logger.info(`[intent-analysis] ${alreadyDone.size} done, ${remaining.length} to process`)

    const client = createOpenRouterClient(apiKey)
    const total = keywords.length
    let processed = alreadyDone.size

    // ── Split into batches ─────────────────────────────────────────────────────
    const batches: typeof remaining[] = []
    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
        batches.push(remaining.slice(i, i + BATCH_SIZE))
    }

    logger.info(`[intent-analysis] ${batches.length} batches × ${BATCH_SIZE} keywords | ${PARALLEL_BATCHES} parallel`)

    // ── Process batches in parallel groups ─────────────────────────────────────
    for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
        const parallelGroup = batches.slice(i, i + PARALLEL_BATCHES)

        const groupResults = await Promise.allSettled(
            parallelGroup.map(async (batch) => {
                const items = batch.map(kw => ({
                    keyword: kw.keyword_en || kw.keyword,
                    topApps: serpMap.get(kw.id) || [],
                }))

                // Use retry wrapper — handles 429/5xx with exponential backoff
                const intentResults = await classifyBatchWithRetry(items, appProfile, client, selectedModel)

                // Upsert results for this batch
                const upsertRows = batch.map((kw, idx) => ({
                    run_id,
                    keyword_id: kw.id,
                    dataset_id,
                    primary_intent: intentResults[idx]?.primary_intent ?? 'discovery',
                    sub_intent: intentResults[idx]?.sub_intent ?? '',
                    intent_score: intentResults[idx]?.intent_score ?? 50,
                    raw_output: intentResults[idx] ?? {},
                    is_qualified: true,
                }))

                const { error: upsertErr } = await supabase
                    .from('keyword_intent_results')
                    .upsert(upsertRows, { onConflict: 'run_id,keyword_id' })

                if (upsertErr) {
                    logger.warn(`[intent-analysis] Upsert error: ${upsertErr.message}`)
                }

                return batch.length
            })
        )

        // Count processed
        for (const result of groupResults) {
            if (result.status === 'fulfilled') {
                processed += result.value
            } else {
                processed += parallelGroup[groupResults.indexOf(result)]?.length ?? 0
                logger.warn(`[intent-analysis] Parallel batch failed: ${result.reason}`)
            }
        }

        const percent = Math.round((processed / total) * 100)
        await updateJobProgress(job.id, percent)

        await supabase
            .from('intent_analysis_runs')
            .update({ processed_keywords: processed })
            .eq('id', run_id)

        logger.info(`[intent-analysis] ${processed}/${total} (${percent}%) — batch group ${Math.floor(i / PARALLEL_BATCHES) + 1}/${Math.ceil(batches.length / PARALLEL_BATCHES)}`)

        // Small delay between parallel groups to avoid rate limits
        if (i + PARALLEL_BATCHES < batches.length) {
            await sleep(500)
        }
    }

    logger.info(`[intent-analysis] Job ${job.id}: completed`)
}
