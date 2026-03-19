/**
 * Clustering Job Handler
 * job_type = 'clustering'
 *
 * After intent_analysis completes, this job:
 * 1. Loads all keyword_intent_results for the run
 * 2. Loads serp_snapshots to compute Jaccard overlap between keywords
 * 3. Groups keywords into intent clusters (Jaccard ≥ 0.25 + same primary_intent)
 * 4. Names each cluster with OpenRouter minimax/minimax-m2.5:free (1 batch call)
 * 5. Saves keyword_clusters + keyword_cluster_memberships
 * 6. Updates keyword_intent_results.cluster_id
 */

import OpenAI from 'openai'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import type { AnalysisJob } from '../types'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
// Read model from env — allows overriding without code change.
// Default: minimax/minimax-m2.5:free (confirmed working on OpenRouter free tier)
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'minimax/minimax-m2.5:free'
const JACCARD_THRESHOLD = 0.25  // keywords sharing ≥25% of top apps are candidates

interface IntentResultRow {
    id: string
    keyword_id: string
    primary_intent: string
    sub_intent: string | null
    intent_score: number
}

interface KeywordRow {
    id: string
    keyword: string
    keyword_en: string | null
}

interface ClusterGroup {
    primary_intent: string
    memberIds: string[]       // keyword_ids
    memberResultIds: string[] // keyword_intent_result ids
    memberScores: number[]    // Jaccard similarity score for each member
    subIntents: string[]
    sampleKeywords: string[]
}

interface ClusterNameResult {
    cluster_name: string
    cluster_theme: string
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

/** Compute Jaccard similarity between two app ID sets */
function jaccard(appsA: string[], appsB: string[]): number {
    if (appsA.length === 0 && appsB.length === 0) return 0
    const setB = new Set(appsB)
    let intersection = 0
    for (const id of appsA) {
        if (setB.has(id)) intersection++
    }
    const union = new Set([...appsA, ...appsB]).size
    return union === 0 ? 0 : intersection / union
}

/** Union-Find (Disjoint Set) for fast clustering */
class UnionFind {
    private parent: Map<string, string>
    constructor(ids: string[]) {
        this.parent = new Map(ids.map(id => [id, id]))
    }
    find(x: string): string {
        if (this.parent.get(x) !== x) {
            this.parent.set(x, this.find(this.parent.get(x)!))
        }
        return this.parent.get(x)!
    }
    union(x: string, y: string): void {
        const rx = this.find(x)
        const ry = this.find(y)
        if (rx !== ry) this.parent.set(rx, ry)
    }
}

async function nameClustersBatch(
    groups: Array<{ primary_intent: string; subIntents: string[]; sampleKeywords: string[] }>,
    client: OpenAI,
): Promise<ClusterNameResult[]> {
    const prompt = `You are an App Store Optimization expert. Name these keyword intent clusters concisely.

Clusters (${groups.length}):
${groups.map((g, i) => `${i + 1}. Intent: ${g.primary_intent}, Sub-intents: [${g.subIntents.slice(0, 3).join(', ')}], Sample keywords: [${g.sampleKeywords.slice(0, 4).join(', ')}]`).join('\n')}

Return ONLY valid JSON array (no markdown), one item per cluster in the same order:
[
  { "cluster_name": "short descriptive name (2-4 words)", "cluster_theme": "one-sentence theme description" }
]`

    const response = await client.chat.completions.create({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1000,
    })

    const text = (response.choices[0]?.message?.content || '')
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()

    // Protect JSON.parse — LLM may return malformed JSON or extra text
    let results: ClusterNameResult[]
    try {
        results = JSON.parse(text) as ClusterNameResult[]
    } catch (parseErr) {
        logger.warn(`[clustering] nameClustersBatch: JSON parse failed — using fallback names. Error: ${parseErr}`)
        return groups.map((_, i) => ({ cluster_name: `Cluster ${i + 1}`, cluster_theme: '' }))
    }

    // Ensure same length
    if (results.length !== groups.length) {
        return groups.map((_, i) => results[i] || { cluster_name: `Cluster ${i + 1}`, cluster_theme: '' })
    }
    return results
}

export async function handleClusteringJob(job: AnalysisJob): Promise<void> {
    const { run_id, dataset_id } = job.payload as { run_id: string; dataset_id: string }

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

    logger.info(`[clustering] Job ${job.id}: run=${run_id}, dataset=${dataset_id}, model=${OPENROUTER_MODEL}`)

    // ── Load all intent results for this run ─────────────────────────────────
    const { data: intentRows, error: irErr } = await supabase
        .from('keyword_intent_results')
        .select('id, keyword_id, primary_intent, sub_intent, intent_score')
        .eq('run_id', run_id)

    if (irErr || !intentRows || intentRows.length === 0) {
        logger.warn(`[clustering] No intent results found for run ${run_id}`)
        return
    }

    logger.info(`[clustering] Job ${job.id}: ${intentRows.length} intent results loaded`)

    // ── Load SERP snapshots for overlap computation ───────────────────────────
    const keywordIds = intentRows.map(r => r.keyword_id)

    const { data: serpRows } = await supabase
        .from('serp_snapshots')
        .select('keyword_id, top_apps')
        .eq('run_id', run_id)
        .in('keyword_id', keywordIds)

    const serpMap = new Map<string, string[]>()
    for (const row of (serpRows || [])) {
        const appIds = (row.top_apps || []).map((a: any) => String(a.appId)).filter(Boolean)
        serpMap.set(row.keyword_id, appIds)
    }

    // ── Load keyword names for naming prompt ─────────────────────────────────
    const { data: kwRows } = await supabase
        .from('keywords')
        .select('id, keyword, keyword_en')
        .in('id', keywordIds)

    const kwMap = new Map<string, KeywordRow>()
    for (const kw of (kwRows || [])) {
        kwMap.set(kw.id, kw)
    }

    // ── Build intent groups: same primary_intent = candidate for same cluster ─
    const intentGroupMap = new Map<string, IntentResultRow[]>()
    for (const row of intentRows) {
        const key = row.primary_intent || 'ambiguous'
        if (!intentGroupMap.has(key)) intentGroupMap.set(key, [])
        intentGroupMap.get(key)!.push(row)
    }

    // ── Within each intent group, apply Jaccard clustering ───────────────────
    const clusterGroups: ClusterGroup[] = []

    for (const [primaryIntent, group] of intentGroupMap) {
        if (group.length === 1) {
            clusterGroups.push({
                primary_intent: primaryIntent,
                memberIds: [group[0].keyword_id],
                memberResultIds: [group[0].id],
                memberScores: [1.0], // sole member of its own cluster
                subIntents: [group[0].sub_intent || ''],
                sampleKeywords: [kwMap.get(group[0].keyword_id)?.keyword_en || kwMap.get(group[0].keyword_id)?.keyword || ''],
            })
            continue
        }

        const ids = group.map(r => r.keyword_id)
        const uf = new UnionFind(ids)

        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const appsA = serpMap.get(ids[i]) || []
                const appsB = serpMap.get(ids[j]) || []
                if (jaccard(appsA, appsB) >= JACCARD_THRESHOLD) {
                    uf.union(ids[i], ids[j])
                }
            }
        }

        const rootMap = new Map<string, IntentResultRow[]>()
        for (const row of group) {
            const root = uf.find(row.keyword_id)
            if (!rootMap.has(root)) rootMap.set(root, [])
            rootMap.get(root)!.push(row)
        }

        for (const members of rootMap.values()) {
            // Compute avg Jaccard score within this cluster for each member
            const memberScores = members.map(r => {
                const appsA = serpMap.get(r.keyword_id) || []
                const otherApps = members
                    .filter(m => m.keyword_id !== r.keyword_id)
                    .flatMap(m => serpMap.get(m.keyword_id) || [])
                return otherApps.length > 0 ? jaccard(appsA, otherApps) : 0.5
            })
            clusterGroups.push({
                primary_intent: primaryIntent,
                memberIds: members.map(r => r.keyword_id),
                memberResultIds: members.map(r => r.id),
                memberScores,
                subIntents: members.map(r => r.sub_intent || '').filter(Boolean),
                sampleKeywords: members
                    .slice(0, 5)
                    .map(r => kwMap.get(r.keyword_id)?.keyword_en || kwMap.get(r.keyword_id)?.keyword || ''),
            })
        }
    }

    logger.info(`[clustering] Job ${job.id}: ${clusterGroups.length} clusters formed`)

    // ── Name clusters with OpenRouter (1 batch call) ──────────────────────────
    const client = createOpenRouterClient(apiKey)
    let clusterNames: ClusterNameResult[]

    try {
        clusterNames = await nameClustersBatch(
            clusterGroups.map(g => ({
                primary_intent: g.primary_intent,
                subIntents: g.subIntents,
                sampleKeywords: g.sampleKeywords,
            })),
            client,
        )
    } catch (err: any) {
        logger.warn(`[clustering] OpenRouter naming failed, using fallbacks: ${err.message}`)
        clusterNames = clusterGroups.map((g, i) => ({
            cluster_name: `${g.primary_intent.replace(/_/g, ' ')} cluster ${i + 1}`,
            cluster_theme: g.subIntents[0] || '',
        }))
    }

    // ── Fetch dataset workspace_id ────────────────────────────────────────────
    const { data: ds } = await supabase
        .from('datasets')
        .select('workspace_id')
        .eq('id', dataset_id)
        .single()

    const workspaceId = ds?.workspace_id

    // ── Insert clusters + memberships ─────────────────────────────────────────
    for (let idx = 0; idx < clusterGroups.length; idx++) {
        const group = clusterGroups[idx]
        const names = clusterNames[idx]

        const memberResults = group.memberIds
            .map(id => intentRows.find(r => r.keyword_id === id))
            .filter(Boolean) as IntentResultRow[]

        const avgScore = memberResults.length > 0
            ? memberResults.reduce((sum, r) => sum + (r.intent_score || 0), 0) / memberResults.length
            : 0
        const maxScore = memberResults.reduce((max, r) => Math.max(max, r.intent_score || 0), 0)

        const { data: clusterRow, error: clusterErr } = await supabase
            .from('keyword_clusters')
            .insert({
                run_id,
                dataset_id,
                workspace_id: workspaceId,
                cluster_name: names.cluster_name,
                cluster_theme: names.cluster_theme,
                cluster_intent: group.primary_intent,
                keyword_count: group.memberIds.length,
                avg_score: parseFloat(avgScore.toFixed(2)),
                max_score: parseFloat(maxScore.toFixed(2)),
            })
            .select('id')
            .single()

        if (clusterErr || !clusterRow) {
            logger.warn(`[clustering] Failed to insert cluster ${idx}: ${clusterErr?.message}`)
            continue
        }

        const clusterId = clusterRow.id

        const memberships = group.memberIds.map((kwId, i) => ({
            cluster_id: clusterId,
            keyword_id: kwId,
            result_id: group.memberResultIds[i] || null,
            // Store actual Jaccard score instead of hardcoded 1.0
            // Members within the same intent group without SERP overlap default to 0.5
            similarity_score: group.memberScores?.[i] ?? 0.5,
        }))

        const { error: memErr } = await supabase
            .from('keyword_cluster_memberships')
            .insert(memberships)

        if (memErr) {
            logger.warn(`[clustering] Failed to insert memberships for cluster ${clusterId}: ${memErr.message}`)
        }

        const { error: updateErr } = await supabase
            .from('keyword_intent_results')
            .update({ cluster_id: clusterId })
            .in('keyword_id', group.memberIds)
            .eq('run_id', run_id)

        if (updateErr) {
            logger.warn(`[clustering] Failed to update cluster_id on intent results: ${updateErr.message}`)
        }
    }

    // ── Mark run as fully completed ───────────────────────────────────────────
    await supabase
        .from('intent_analysis_runs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', run_id)

    await supabase
        .from('analysis_jobs')
        .update({ progress_percent: 100 })
        .eq('id', job.id)

    logger.info(`[clustering] Job ${job.id}: completed — ${clusterGroups.length} clusters created`)
}
