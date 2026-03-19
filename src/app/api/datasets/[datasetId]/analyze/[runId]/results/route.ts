import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/datasets/[datasetId]/analyze/[runId]/results
 * Returns per-keyword intent classification results for a given analysis run.
 *
 * Query params:
 *   intent (optional) — filter by primary_intent
 *   limit  (optional) — max rows (default 500)
 *   offset (optional) — pagination offset (default 0)
 *
 * Response:
 *   {
 *     run:     { id, status, total_keywords, processed_keywords },
 *     results: KeywordIntentResult[],
 *     total:   number
 *   }
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ datasetId: string; runId: string }> }
) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { datasetId, runId } = await params
    const { searchParams } = new URL(req.url)
    const intentFilter = searchParams.get('intent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '500', 10), 1000)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Verify the run belongs to this dataset
    const { data: run, error: runErr } = await supabase
        .from('intent_analysis_runs')
        .select('id, status, total_keywords, processed_keywords')
        .eq('id', runId)
        .eq('dataset_id', datasetId)
        .single()

    if (runErr || !run) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    // Build intent results query
    let query = supabase
        .from('keyword_intent_results')
        .select(`
            id,
            keyword_id,
            primary_intent,
            sub_intent,
            intent_score,
            is_qualified,
            disqualify_reason,
            cluster_id,
            created_at
        `, { count: 'exact' })
        .eq('run_id', runId)
        .eq('dataset_id', datasetId)
        .order('intent_score', { ascending: false })
        .range(offset, offset + limit - 1)

    if (intentFilter) {
        query = query.eq('primary_intent', intentFilter)
    }

    const { data: intentRows, error: intentErr, count } = await query

    if (intentErr) {
        return NextResponse.json({ error: `Failed to fetch results: ${intentErr.message}` }, { status: 500 })
    }

    if (!intentRows || intentRows.length === 0) {
        return NextResponse.json({ run, results: [], total: 0 })
    }

    // Join keyword text
    const kwIds = [...new Set(intentRows.map(r => r.keyword_id))]
    const { data: kwRows } = await supabase
        .from('keywords')
        .select('id, keyword, keyword_en')
        .in('id', kwIds)

    const kwMap = new Map((kwRows || []).map(k => [k.id, k]))

    const results = intentRows.map(row => {
        const kw = kwMap.get(row.keyword_id)
        return {
            ...row,
            keyword: kw?.keyword_en || kw?.keyword || row.keyword_id,
            keyword_original: kw?.keyword || null,
        }
    })

    return NextResponse.json({
        run,
        results,
        total: count ?? results.length,
    })
}
