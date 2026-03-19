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
// Read model from env — allows overriding without code change.
// Default: minimax/minimax-m2.5:free (confirmed working on OpenRouter free tier)
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'minimax/minimax-m2.5:free'
const BATCH_SIZE = 15          // keywords per API call
const PARALLEL_BATCHES = 1     // sequential to avoid rate limits on free tier

type IntentType = 'core_feature' | 'adjacent_feature' | 'competitor' | 'unrelated' | 'ambiguous'

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
 * Classify a BATCH of keywords in a single OpenRouter call.
 * Returns an array aligned with the input keywords array.
 */
async function classifyBatch(
    items: Array<{ keyword: string; topApps: Array<{ name: string; position: number }> }>,
    appProfile: AppProfile,
    client: OpenAI,
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

    const prompt = `You are an ASO expert. Classify each keyword's intent relative to the target app.

${appContext}

Keywords to classify:
${itemsText}

Rules:
- core_feature: top apps match target app's core use case (score 70-100)
- adjacent_feature: related but different category (score 40-70)
- competitor: dominated by direct competitors (score 30-60)
- unrelated: no meaningful connection (score 0-30)
- ambiguous: mixed results (score 30-60)

Return ONLY a valid JSON array, one object per keyword, in the same order:
[{"keyword":"...","primary_intent":"core_feature|adjacent_feature|competitor|unrelated|ambiguous","sub_intent":"2-4 word phrase","intent_score":0-100}]`

    const response = await client.chat.completions.create({
        model: OPENROUTER_MODEL,
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
            primary_intent: 'ambiguous' as IntentType,
            sub_intent: 'parse error',
            intent_score: 50,
        }))
    }

    // Validate length — pad with fallbacks if needed
    const validTypes: IntentType[] = ['core_feature', 'adjacent_feature', 'competitor', 'unrelated', 'ambiguous']
    const normalized = items.map((item, i) => {
        const r = results[i] || {}
        const intent = validTypes.includes(r.primary_intent as IntentType) ? r.primary_intent as IntentType : 'ambiguous'
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
    const { keyword_ids, run_id, dataset_id } = job.payload as {
        keyword_ids: string[]
        run_id: string
        dataset_id: string
    }

    if (!keyword_ids || keyword_ids.length === 0) {
        logger.warn(`[intent-analysis] Job ${job.id}: empty keyword_ids`)
        return
    }

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

    logger.info(`[intent-analysis] Job ${job.id}: ${keyword_ids.length} keywords | model=${OPENROUTER_MODEL} | batch=${BATCH_SIZE} | parallel=${PARALLEL_BATCHES}`)

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
        logger.warn(`[intent-analysis] No SERP snapshots found for run ${run_id} — all keywords will be ambiguous`)
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

                let intentResults: IntentResult[]
                try {
                    intentResults = await classifyBatch(items, appProfile, client)
                } catch (err: any) {
                    logger.warn(`[intent-analysis] Batch failed: ${err.message}`)
                    intentResults = items.map(item => ({
                        keyword: item.keyword,
                        primary_intent: 'ambiguous' as IntentType,
                        sub_intent: 'api error',
                        intent_score: 50,
                    }))
                }

                // Upsert results for this batch
                const upsertRows = batch.map((kw, idx) => ({
                    run_id,
                    keyword_id: kw.id,
                    dataset_id,
                    primary_intent: intentResults[idx]?.primary_intent ?? 'ambiguous',
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
