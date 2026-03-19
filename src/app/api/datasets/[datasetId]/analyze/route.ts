import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/datasets/[datasetId]/analyze
 * Creates an analysis run + enqueues 3 sequential Worker jobs:
 *   1. serp_fetch      (priority 5) — fetch store SERP for each keyword
 *   2. intent_analysis (priority 6) — classify intent via LLM
 *   3. clustering      (priority 7) — group keywords into clusters
 *
 * Ordering rationale:
 *   - serpJob is created FIRST so its UUID can be used as the FK
 *     `intent_analysis_runs.job_id` (NOT NULL REFERENCES analysis_jobs.id).
 *   - run is created after serpJob, before intent/cluster jobs, so run_id
 *     is fully available in all subsequent job payloads — no race condition.
 *   - No separate "patch run_id" step needed.
 *
 * Body: { keywordIds: string[] }
 * Returns: { serpJobId, intentJobId, clusterJobId, runId, async: true }
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ datasetId: string }> }
) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { datasetId } = await params

    let keywordIds: string[]
    try {
        const body = await req.json()
        keywordIds = body.keywordIds
        if (!Array.isArray(keywordIds) || keywordIds.length === 0) {
            return NextResponse.json({ error: 'keywordIds must be a non-empty array' }, { status: 400 })
        }
        // Validate UUID format to prevent injection / bad data
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (!keywordIds.every(id => UUID_RE.test(id))) {
            return NextResponse.json({ error: 'All keywordIds must be valid UUIDs' }, { status: 400 })
        }
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // Verify dataset exists & user has access, and has a target_app_profile
    const { data: dataset, error: dsErr } = await supabase
        .from('datasets')
        .select('id, workspace_id, target_app_profile')
        .eq('id', datasetId)
        .single()

    if (dsErr || !dataset) {
        return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
    }

    if (!dataset.target_app_profile) {
        return NextResponse.json({
            error: 'Target App Profile is required before running analysis. Generate a profile first.'
        }, { status: 400 })
    }

    // Verify keyword IDs actually belong to this dataset (prevent cross-dataset access)
    const { data: validKeywords, error: kwValErr } = await supabase
        .from('keywords')
        .select('id')
        .eq('dataset_id', datasetId)
        .in('id', keywordIds.slice(0, 500))

    if (kwValErr) {
        return NextResponse.json({ error: 'Failed to validate keywords' }, { status: 500 })
    }

    const validIds = (validKeywords || []).map((k: { id: string }) => k.id)
    if (validIds.length === 0) {
        return NextResponse.json({ error: 'No valid keywords found for this dataset' }, { status: 400 })
    }

    // Hard cap at 500 keywords (use only validated IDs)
    const capped = validIds.slice(0, 500)
    const workspaceId = dataset.workspace_id

    const commonJobFields = {
        workspace_id: workspaceId,
        dataset_id: datasetId,
        status: 'pending',
        progress_percent: 0,
        retry_count: 0,
        max_retries: 3,
    }

    // ── 1. Enqueue serp_fetch FIRST (priority 5) ──────────────────────────────
    // serpJob.id is needed as FK for intent_analysis_runs.job_id.
    // run_id is not yet known here — patched below after run is created.
    const { data: serpJob, error: serpErr } = await supabase
        .from('analysis_jobs')
        .insert({
            ...commonJobFields,
            job_type: 'serp_fetch',
            priority: 5,
            // run_id will be patched in step 3; worker will not start until priority ordering
            payload: { keyword_ids: capped, dataset_id: datasetId },
        })
        .select('id')
        .single()

    if (serpErr || !serpJob) {
        return NextResponse.json({ error: `Failed to enqueue serp_fetch: ${serpErr?.message}` }, { status: 500 })
    }

    // ── 2. Create intent_analysis_run with serpJob.id as FK ───────────────────
    // run is created after serpJob exists to satisfy the NOT NULL FK constraint.
    const { data: run, error: runErr } = await supabase
        .from('intent_analysis_runs')
        .insert({
            dataset_id: datasetId,
            workspace_id: workspaceId,
            job_id: serpJob.id,   // valid FK reference — no placeholder needed
            status: 'running',
            total_keywords: capped.length,
            processed_keywords: 0,
        })
        .select('id')
        .single()

    if (runErr || !run) {
        await supabase.from('analysis_jobs').delete().eq('id', serpJob.id)
        return NextResponse.json({ error: `Failed to create analysis run: ${runErr?.message}` }, { status: 500 })
    }

    const runId = run.id

    // ── 3. Patch run_id into serpJob payload ──────────────────────────────────
    // This is the only patch needed — serpJob was created before run existed.
    // intentJob and clusterJob (steps 4-5) already have run_id from the start.
    await supabase
        .from('analysis_jobs')
        .update({ payload: { keyword_ids: capped, run_id: runId, dataset_id: datasetId } })
        .eq('id', serpJob.id)

    // ── 4. Enqueue intent_analysis job (priority 6) with run_id ──────────────
    const { data: intentJob, error: intentErr } = await supabase
        .from('analysis_jobs')
        .insert({
            ...commonJobFields,
            job_type: 'intent_analysis',
            priority: 6,
            payload: { keyword_ids: capped, run_id: runId, dataset_id: datasetId },
        })
        .select('id')
        .single()

    if (intentErr || !intentJob) {
        await supabase.from('analysis_jobs').delete().eq('id', serpJob.id)
        await supabase.from('intent_analysis_runs').delete().eq('id', runId)
        return NextResponse.json({ error: `Failed to enqueue intent_analysis: ${intentErr?.message}` }, { status: 500 })
    }

    // ── 5. Enqueue clustering job (priority 7) with run_id ───────────────────
    const { data: clusterJob, error: clusterErr } = await supabase
        .from('analysis_jobs')
        .insert({
            ...commonJobFields,
            job_type: 'clustering',
            priority: 7,
            payload: { run_id: runId, dataset_id: datasetId },
        })
        .select('id')
        .single()

    if (clusterErr || !clusterJob) {
        await supabase.from('analysis_jobs').delete().eq('id', serpJob.id)
        await supabase.from('analysis_jobs').delete().eq('id', intentJob.id)
        await supabase.from('intent_analysis_runs').delete().eq('id', runId)
        return NextResponse.json({ error: `Failed to enqueue clustering: ${clusterErr?.message}` }, { status: 500 })
    }

    return NextResponse.json({
        serpJobId: serpJob.id,
        intentJobId: intentJob.id,
        clusterJobId: clusterJob.id,
        runId,
        keywordCount: capped.length,
        async: true,
    })
}
