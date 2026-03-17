import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/datasets/[datasetId]/analyze
 * Creates an analysis run + enqueues a `serp_fetch` job for the Worker.
 *
 * Body: { keywordIds: string[] }
 * Returns: { jobId, runId, async: true }
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ datasetId: string }> }
) {
    const supabase = await createClient()

    // Auth check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { datasetId } = await params

    // Parse body
    let keywordIds: string[]
    try {
        const body = await req.json()
        keywordIds = body.keywordIds
        if (!Array.isArray(keywordIds) || keywordIds.length === 0) {
            return NextResponse.json({ error: 'keywordIds must be a non-empty array' }, { status: 400 })
        }
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // Verify dataset exists & has a target_app_profile
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

    // Cap at 500 keywords (hard cap from SPEC v5)
    const capped = keywordIds.slice(0, 500)

    // 1. Create intent_analysis_run record
    const { data: run, error: runErr } = await supabase
        .from('intent_analysis_runs')
        .insert({
            dataset_id: datasetId,
            status: 'pending',
            total_keywords: capped.length,
            processed_keywords: 0,
        })
        .select('id')
        .single()

    if (runErr || !run) {
        return NextResponse.json({ error: `Failed to create analysis run: ${runErr?.message}` }, { status: 500 })
    }

    // 2. Enqueue serp_fetch job
    const { data: job, error: jobErr } = await supabase
        .from('analysis_jobs')
        .insert({
            workspace_id: dataset.workspace_id,
            dataset_id: datasetId,
            job_type: 'serp_fetch',
            status: 'pending',
            progress_percent: 0,
            payload: {
                keyword_ids: capped,
                run_id: run.id,
            },
            retry_count: 0,
            max_retries: 3,
        })
        .select('id')
        .single()

    if (jobErr || !job) {
        // Cleanup the orphaned run
        await supabase.from('intent_analysis_runs').delete().eq('id', run.id)
        return NextResponse.json({ error: `Failed to enqueue job: ${jobErr?.message}` }, { status: 500 })
    }

    // 3. Link job back to run
    await supabase
        .from('intent_analysis_runs')
        .update({ job_id: job.id })
        .eq('id', run.id)

    return NextResponse.json({
        jobId: job.id,
        runId: run.id,
        keywordCount: capped.length,
        async: true,
    })
}
