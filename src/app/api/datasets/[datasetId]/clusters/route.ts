import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/datasets/[datasetId]/clusters
 * Returns cluster results and intent stats for the latest analysis run.
 *
 * Query params:
 *   run_id (optional) — specific run, defaults to latest
 *
 * Response:
 *   {
 *     run: { id, status, total_keywords, processed_keywords },
 *     stats: { total_analyzed, core_feature, feature_variant, problem_solving, discovery, brand_competitor, category, adjacent, unrelated },
 *     clusters: ClusterWithKeywords[]
 *   }
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ datasetId: string }> }
) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { datasetId } = await params
    const { searchParams } = new URL(req.url)
    const runId = searchParams.get('run_id')

    // ── Find the run ────────────────────────────────────────────────────────
    let runQuery = supabase
        .from('intent_analysis_runs')
        .select('id, status, total_keywords, processed_keywords, started_at, completed_at')
        .eq('dataset_id', datasetId)
        .order('created_at', { ascending: false })
        .limit(1)

    if (runId) {
        runQuery = supabase
            .from('intent_analysis_runs')
            .select('id, status, total_keywords, processed_keywords, started_at, completed_at')
            .eq('id', runId)
            .eq('dataset_id', datasetId)
            .limit(1)
    }

    const { data: runs, error: runErr } = await runQuery

    if (runErr || !runs || runs.length === 0) {
        return NextResponse.json({ run: null, stats: null, clusters: [] })
    }

    const run = runs[0]

    // ── Intent stats from keyword_intent_results ────────────────────────────
    const { data: intentRows } = await supabase
        .from('keyword_intent_results')
        .select('primary_intent')
        .eq('run_id', run.id)

    const stats = {
        total_analyzed: intentRows?.length ?? 0,
        core_feature: 0,
        feature_variant: 0,
        problem_solving: 0,
        discovery: 0,
        brand_competitor: 0,
        category: 0,
        adjacent: 0,
        unrelated: 0,
    }

    for (const row of (intentRows || [])) {
        const intent = row.primary_intent as keyof typeof stats
        if (intent in stats) {
            (stats as any)[intent]++
        }
    }

    // ── Clusters with member keywords ───────────────────────────────────────
    const { data: clusterRows } = await supabase
        .from('keyword_clusters')
        .select(`
            id, cluster_name, cluster_theme, cluster_intent,
            keyword_count, avg_score, max_score, opportunity_rank
        `)
        .eq('run_id', run.id)
        .order('keyword_count', { ascending: false })

    if (!clusterRows || clusterRows.length === 0) {
        return NextResponse.json({ run, stats, clusters: [] })
    }

    // Load memberships + keyword names for each cluster
    const clusterIds = clusterRows.map(c => c.id)

    const { data: memberships } = await supabase
        .from('keyword_cluster_memberships')
        .select('cluster_id, keyword_id')
        .in('cluster_id', clusterIds)

    const { data: intentResultMap } = await supabase
        .from('keyword_intent_results')
        .select('keyword_id, primary_intent, sub_intent, intent_score')
        .eq('run_id', run.id)

    const intentByKeyword = new Map(
        (intentResultMap || []).map(r => [r.keyword_id, { primary_intent: r.primary_intent, sub_intent: r.sub_intent, intent_score: r.intent_score }])
    )

    // Load keyword texts
    const memberKwIds = [...new Set((memberships || []).map(m => m.keyword_id))]
    const { data: kwRows } = memberKwIds.length > 0
        ? await supabase
            .from('keywords')
            .select('id, keyword, keyword_en')
            .in('id', memberKwIds)
        : { data: [] }

    const kwMap = new Map((kwRows || []).map(k => [k.id, k]))

    // Build membership index
    const membersByCluster = new Map<string, string[]>()
    for (const m of (memberships || [])) {
        if (!membersByCluster.has(m.cluster_id)) membersByCluster.set(m.cluster_id, [])
        membersByCluster.get(m.cluster_id)!.push(m.keyword_id)
    }

    const clusters = clusterRows.map(cluster => {
        const memberKwIds = membersByCluster.get(cluster.id) || []
        const keywords = memberKwIds.map(kwId => {
            const kw = kwMap.get(kwId)
            const intent = intentByKeyword.get(kwId)
            return {
                id: kwId,
                keyword: kw?.keyword || kw?.keyword_en || kwId,
                primary_intent: intent?.primary_intent || null,
                sub_intent: intent?.sub_intent || null,
                intent_score: intent?.intent_score ?? null,
            }
        })

        return {
            ...cluster,
            keywords,
        }
    })

    return NextResponse.json({ run, stats, clusters })
}
