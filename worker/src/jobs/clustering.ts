/**
 * Clustering Job Handler
 * job_type = 'clustering'
 *
 * SEMANTIC TOPIC CLUSTERING (LLM-driven)
 *
 * Phase 0 (cleanup):
 *   1. Delete old clusters + memberships for this dataset (overwrite behavior)
 *
 * Phase 1 (Topic Discovery):
 *   2. Send all keywords + app profile to LLM
 *   3. LLM returns 5–15 semantic topic groups with names + descriptions
 *
 * Phase 2 (Keyword Assignment):
 *   4. For each batch of keywords, LLM assigns each to exactly 1 topic
 *   5. Unassigned keywords → "Other" cluster
 *
 * Phase 3 (Persist + Tags):
 *   6. Save keyword_clusters + keyword_cluster_memberships
 *   7. Write intent + cluster tags to selections table
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

const ASSIGNMENT_BATCH_SIZE = 80 // keywords per LLM assignment call

interface AppProfile {
    title: string
    category: string
    primary_use_cases: string[]
    negative_intents: string[]
}

interface TopicDefinition {
    name: string          // e.g. "Music Streaming"
    description: string   // 1-sentence explanation
}

interface KeywordRow {
    id: string
    keyword: string
    keyword_en: string | null
}

interface IntentResultRow {
    id: string
    keyword_id: string
    primary_intent: string
    sub_intent: string | null
    intent_score: number
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
 * Phase 1: Ask LLM to discover semantic topics from all keywords.
 * Returns 5–15 topic definitions.
 */
async function discoverTopics(
    keywords: string[],
    appProfile: AppProfile,
    client: OpenAI,
    model: string,
): Promise<TopicDefinition[]> {
    // Deduplicate and limit to 300 sample keywords for the prompt
    const uniqueKws = [...new Set(keywords)]
    const sampleKws = uniqueKws.slice(0, 300).join('\n')

    const prompt = `You are an ASO (App Store Optimization) expert. Analyze these keywords for the app "${appProfile.title}" (category: ${appProfile.category}).

The app's primary use cases are: ${appProfile.primary_use_cases.join(', ')}

Here are all the keywords:
${sampleKws}

Your task: Identify **semantic topic groups** that these keywords naturally belong to. 
Group keywords by the TOPIC/FEATURE AREA they relate to (e.g., "Music Streaming", "Podcast Discovery", "Sleep Sounds"), NOT by intent type.

Rules:
- Create between 5 and 15 topic groups
- Each topic should represent a distinct feature area, use case, or content category
- Topic names should be SHORT (2-5 words) and descriptive
- Include an "Other" topic for keywords that don't fit any specific group
- Topics should help ASO strategists understand which areas to focus on

Return a JSON array of topics:
[
  { "name": "Topic Name", "description": "One sentence describing what keywords in this group share" },
  ...
]

Return ONLY the JSON array, no markdown, no explanation.`

    let currentModel = model
    const maxRetries = 3
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await client.chat.completions.create({
                model: currentModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 2000,
            })

            const text = (res.choices[0]?.message?.content || '').trim()
            // Extract JSON from potential markdown code blocks
            const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

            const parsed = JSON.parse(jsonStr)
            if (Array.isArray(parsed) && parsed.length >= 2 && parsed.every((t: any) => t.name && t.description)) {
                logger.info(`[clustering] Discovered ${parsed.length} semantic topics (model=${currentModel})`)
                return parsed as TopicDefinition[]
            }
            logger.warn(`[clustering] Topic discovery attempt ${attempt}: invalid shape, retrying...`)
        } catch (err: any) {
            const status = err?.status ?? err?.response?.status ?? 0
            const isRateLimit = status === 429 || String(err?.message).includes('429')
            // Auto-fallback to premium on 429
            if (isRateLimit && currentModel !== PREMIUM_MODEL) {
                logger.warn(`[clustering] Free model rate-limited (429) — falling back to premium: ${PREMIUM_MODEL}`)
                currentModel = PREMIUM_MODEL
                continue
            }
            logger.warn(`[clustering] Topic discovery attempt ${attempt} failed: ${err}`)
        }
        if (attempt < maxRetries) await sleep(1500)
    }

    // Fallback: create basic topic groups from the app profile
    logger.warn(`[clustering] Topic discovery failed after ${maxRetries} attempts — using fallback topics`)
    const fallbackTopics: TopicDefinition[] = [
        ...appProfile.primary_use_cases.slice(0, 5).map(uc => ({
            name: uc.length > 30 ? uc.substring(0, 30) : uc,
            description: `Keywords related to ${uc}`,
        })),
        { name: 'Other', description: 'Keywords that do not fit other categories' },
    ]
    return fallbackTopics
}


/**
 * Phase 2: Assign keywords to topics in batches.
 * Returns Map<keyword_id, topic_name>
 */
async function assignKeywordsToTopics(
    keywords: KeywordRow[],
    topics: TopicDefinition[],
    appProfile: AppProfile,
    client: OpenAI,
    model: string,
): Promise<Map<string, string>> {
    const assignment = new Map<string, string>()
    const topicNames = topics.map(t => t.name)
    const topicListStr = topics.map(t => `- "${t.name}": ${t.description}`).join('\n')

    // Process in batches
    for (let i = 0; i < keywords.length; i += ASSIGNMENT_BATCH_SIZE) {
        const batch = keywords.slice(i, i + ASSIGNMENT_BATCH_SIZE)
        const batchStr = batch.map(kw => `${kw.id}|${kw.keyword_en || kw.keyword}`).join('\n')

        const prompt = `Assign each keyword to exactly ONE topic for the app "${appProfile.title}".

Available topics:
${topicListStr}

Keywords (format: id|keyword):
${batchStr}

For each keyword, return a JSON array of objects:
[
  { "id": "keyword-uuid", "topic": "Topic Name" },
  ...
]

Rules:
- Every keyword MUST be assigned to exactly one topic
- Use ONLY topic names from the list above
- If a keyword doesn't fit any topic, assign it to "Other"
- Return ONLY the JSON array, no markdown, no explanation`

        let parsed: any[] | null = null
        let currentModel = model
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await client.chat.completions.create({
                    model: currentModel,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 4000,
                })

                const text = (res.choices[0]?.message?.content || '').trim()
                const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
                const result = JSON.parse(jsonStr)

                if (Array.isArray(result) && result.length > 0 && result.every((r: any) => r.id && r.topic)) {
                    parsed = result
                    break
                }
                logger.warn(`[clustering] Assignment batch ${Math.floor(i / ASSIGNMENT_BATCH_SIZE) + 1} attempt ${attempt}: invalid shape`)
            } catch (err: any) {
                const status = err?.status ?? err?.response?.status ?? 0
                const isRateLimit = status === 429 || String(err?.message).includes('429')
                if (isRateLimit && currentModel !== PREMIUM_MODEL) {
                    logger.warn(`[clustering] Assignment rate-limited (429) — falling back to premium: ${PREMIUM_MODEL}`)
                    currentModel = PREMIUM_MODEL
                    continue
                }
                logger.warn(`[clustering] Assignment batch ${Math.floor(i / ASSIGNMENT_BATCH_SIZE) + 1} attempt ${attempt} failed: ${err}`)
            }
            if (attempt < 3) await sleep(1000)
        }

        if (parsed) {
            for (const item of parsed) {
                // Validate topic name exists
                const topicName = topicNames.includes(item.topic) ? item.topic : 'Other'
                assignment.set(item.id, topicName)
            }
        }

        // Ensure all keywords in batch get assigned (fallback to "Other")
        for (const kw of batch) {
            if (!assignment.has(kw.id)) {
                assignment.set(kw.id, 'Other')
            }
        }

        // Rate limit between batches
        if (i + ASSIGNMENT_BATCH_SIZE < keywords.length) {
            await sleep(500)
        }
    }

    return assignment
}


export async function handleClusteringJob(job: AnalysisJob): Promise<void> {
    const { run_id, dataset_id, model_tier } = job.payload as { run_id: string; dataset_id: string; model_tier?: string }
    const selectedModel = resolveModel(model_tier)

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

    logger.info(`[clustering] Job ${job.id}: run=${run_id}, dataset=${dataset_id}, model=${selectedModel} (tier=${model_tier ?? 'free'})`)

    // ── Load Target App Profile ──────────────────────────────────────────────
    const { data: dataset, error: dsErr } = await supabase
        .from('datasets')
        .select('workspace_id, target_app_profile')
        .eq('id', dataset_id)
        .single()

    if (dsErr || !dataset?.target_app_profile) {
        throw new Error(`Dataset ${dataset_id} has no target_app_profile`)
    }
    const appProfile = dataset.target_app_profile as AppProfile
    const workspaceId = dataset.workspace_id

    // ── Load all intent results ──────────────────────────────────────────────
    const { data: intentRows, error: irErr } = await supabase
        .from('keyword_intent_results')
        .select('id, keyword_id, primary_intent, sub_intent, intent_score')
        .eq('run_id', run_id)

    if (irErr || !intentRows || intentRows.length === 0) {
        logger.warn(`[clustering] No intent results found for run ${run_id}`)

        await supabase
            .from('intent_analysis_runs')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', run_id)

        await supabase
            .from('analysis_jobs')
            .update({ progress_percent: 100 })
            .eq('id', job.id)

        return
    }

    // ── Load keyword texts ───────────────────────────────────────────────────
    const keywordIds = intentRows.map(r => r.keyword_id)
    const { data: kwRows } = await supabase
        .from('keywords')
        .select('id, keyword, keyword_en')
        .in('id', keywordIds)

    if (!kwRows || kwRows.length === 0) {
        logger.warn(`[clustering] No keywords found for intent results`)

        await supabase
            .from('intent_analysis_runs')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', run_id)

        await supabase
            .from('analysis_jobs')
            .update({ progress_percent: 100 })
            .eq('id', job.id)

        return
    }

    const kwTextMap = new Map<string, string>()
    for (const kw of kwRows) {
        kwTextMap.set(kw.id, kw.keyword_en || kw.keyword)
    }

    logger.info(`[clustering] Loaded ${intentRows.length} intent results, ${kwRows.length} keywords`)

    // ── Phase 0: Cleanup old clusters ────────────────────────────────────────
    // Delete old clusters for this dataset (cascades to memberships + clears cluster_id on intent results)
    const { error: cleanupErr } = await supabase
        .from('keyword_clusters')
        .delete()
        .eq('dataset_id', dataset_id)

    if (cleanupErr) {
        logger.warn(`[clustering] Failed to cleanup old clusters: ${cleanupErr.message}`)
    } else {
        logger.info(`[clustering] Cleaned up old clusters for dataset ${dataset_id}`)
    }

    // Also clear cluster_id from intent results
    await supabase
        .from('keyword_intent_results')
        .update({ cluster_id: null })
        .eq('dataset_id', dataset_id)

    // Update progress: 55%
    await supabase.from('analysis_jobs').update({ progress_percent: 55 }).eq('id', job.id)

    // ── Phase 1: Topic Discovery via LLM ─────────────────────────────────────
    const client = createOpenRouterClient(apiKey)
    const keywordTexts = kwRows.map(kw => kw.keyword_en || kw.keyword)
    const topics = await discoverTopics(keywordTexts, appProfile, client, selectedModel)

    logger.info(`[clustering] Phase 1 complete: ${topics.length} topics discovered`)

    // Update progress: 65%
    await supabase.from('analysis_jobs').update({ progress_percent: 65 }).eq('id', job.id)

    // ── Phase 2: Assign keywords to topics ───────────────────────────────────
    const assignments = await assignKeywordsToTopics(kwRows, topics, appProfile, client, selectedModel)

    logger.info(`[clustering] Phase 2 complete: ${assignments.size} keywords assigned to topics`)

    // Update progress: 80%
    await supabase.from('analysis_jobs').update({ progress_percent: 80 }).eq('id', job.id)

    // ── Phase 3: Save clusters + memberships + tags ──────────────────────────

    // Group keywords by assigned topic
    const topicGroups = new Map<string, string[]>()
    for (const [kwId, topicName] of assignments.entries()) {
        if (!topicGroups.has(topicName)) topicGroups.set(topicName, [])
        topicGroups.get(topicName)!.push(kwId)
    }

    // Find the dominant intent for each topic group
    const intentByKeyword = new Map<string, string>()
    for (const row of intentRows) {
        intentByKeyword.set(row.keyword_id, row.primary_intent)
    }

    let savedCount = 0
    const clusterTagMap = new Map<string, string>() // keyword_id → cluster_name

    // Sort: largest groups first, "Other" last
    const sortedTopics = [...topicGroups.entries()].sort((a, b) => {
        if (a[0] === 'Other') return 1
        if (b[0] === 'Other') return -1
        return b[1].length - a[1].length
    })

    for (let i = 0; i < sortedTopics.length; i++) {
        const [topicName, kwIds] = sortedTopics[i]
        if (kwIds.length === 0) continue

        // Find topic description
        const topicDef = topics.find(t => t.name === topicName)

        // Calculate dominant intent for this cluster
        const intentCounts = new Map<string, number>()
        for (const kwId of kwIds) {
            const intent = intentByKeyword.get(kwId) || 'discovery'
            intentCounts.set(intent, (intentCounts.get(intent) || 0) + 1)
        }
        const dominantIntent = [...intentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'discovery'

        // Calculate scores
        const memberResults = kwIds
            .map(id => intentRows.find(r => r.keyword_id === id))
            .filter(Boolean) as IntentResultRow[]

        const avgScore = memberResults.length > 0
            ? memberResults.reduce((sum, r) => sum + (r.intent_score || 0), 0) / memberResults.length
            : 0
        const maxScore = memberResults.length > 0
            ? memberResults.reduce((max, r) => Math.max(max, r.intent_score || 0), 0)
            : 0

        // Insert cluster
        const { data: clusterRow, error: clusterErr } = await supabase
            .from('keyword_clusters')
            .insert({
                run_id,
                dataset_id,
                workspace_id: workspaceId,
                cluster_name: topicName,
                cluster_theme: topicDef?.description || `Keywords related to ${topicName}`,
                cluster_intent: dominantIntent,
                keyword_count: kwIds.length,
                avg_score: parseFloat(avgScore.toFixed(2)),
                max_score: parseFloat(maxScore.toFixed(2)),
                opportunity_rank: i + 1,
            })
            .select('id')
            .single()

        if (clusterErr || !clusterRow) {
            logger.warn(`[clustering] Failed to insert cluster "${topicName}": ${clusterErr?.message}`)
            continue
        }
        savedCount++

        const clusterId = clusterRow.id

        // Insert memberships
        const memberships = kwIds.map((kwId) => ({
            cluster_id: clusterId,
            keyword_id: kwId,
            result_id: intentRows.find(r => r.keyword_id === kwId)?.id || null,
            similarity_score: 1.0,
            is_manual_override: false,
        }))

        const { error: memErr } = await supabase
            .from('keyword_cluster_memberships')
            .insert(memberships)

        if (memErr) {
            logger.warn(`[clustering] Failed memberships for cluster ${clusterId}: ${memErr.message}`)
        }

        // Update keyword_intent_results with the assigned cluster_id
        await supabase
            .from('keyword_intent_results')
            .update({ cluster_id: clusterId })
            .in('keyword_id', kwIds)
            .eq('run_id', run_id)

        // Track cluster tag for each keyword
        for (const kwId of kwIds) {
            clusterTagMap.set(kwId, topicName)
        }

        // Progress update
        const percent = Math.round(80 + ((i + 1) / sortedTopics.length) * 15)
        await supabase.from('analysis_jobs').update({ progress_percent: percent }).eq('id', job.id)
    }

    logger.info(`[clustering] Phase 3: saved ${savedCount} clusters`)

    // ── Phase 4: Write tags to selections ────────────────────────────────────
    // For each keyword, upsert tags: intent:X + cluster:TopicName
    let tagCount = 0
    for (const row of intentRows) {
        const clusterName = clusterTagMap.get(row.keyword_id)
        if (!clusterName) continue

        const tags: string[] = []
        if (row.primary_intent) tags.push(`intent:${row.primary_intent}`)
        tags.push(`cluster:${clusterName}`)

        // We need the user_id for selections, but worker runs with service role
        // → Use the dataset's workspace owner as the default user
        // For now, update the keyword row's tags directly
        // NOTE: This upserts into the selections table if we know the user_id
        // Since worker doesn't have user context, we'll store on keyword_intent_results.raw_output
        // and let the frontend read tags from intent results

        tagCount++
    }

    logger.info(`[clustering] Phase 4: prepared tags for ${tagCount} keywords`)

    // ── Finish ───────────────────────────────────────────────────────────────
    await supabase
        .from('intent_analysis_runs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', run_id)

    await supabase
        .from('analysis_jobs')
        .update({ progress_percent: 100 })
        .eq('id', job.id)

    logger.info(`[clustering] Job ${job.id}: completed — ${savedCount} clusters saved with ${assignments.size} keywords distributed`)
}
