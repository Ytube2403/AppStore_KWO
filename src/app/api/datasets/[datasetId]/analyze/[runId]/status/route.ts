import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/datasets/[datasetId]/analyze/[runId]/status
 * Returns the current status and progress of an analysis run.
 *
 * Response:
 *   {
 *     status: 'running' | 'done' | 'failed',
 *     phase:  'serp_fetch' | 'intent_analysis' | 'clustering' | 'done',
 *     progress: number (0-100),
 *     total_keywords: number,
 *     processed_keywords: number,
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

    // Get the run
    const { data: run, error: runErr } = await supabase
        .from('intent_analysis_runs')
        .select('id, status, total_keywords, processed_keywords')
        .eq('id', runId)
        .eq('dataset_id', datasetId)
        .single()

    if (runErr || !run) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    // Get all jobs for this run to determine current phase
    const { data: jobs } = await supabase
        .from('analysis_jobs')
        .select('job_type, status, progress_percent')
        .contains('payload', { run_id: runId })
        .order('priority', { ascending: true })

    // Determine the current phase from job statuses
    let phase: 'serp_fetch' | 'intent_analysis' | 'clustering' | 'done' = 'serp_fetch'
    let progress = 0

    if (jobs && jobs.length > 0) {
        const serpJob = jobs.find(j => j.job_type === 'serp_fetch')
        const intentJob = jobs.find(j => j.job_type === 'intent_analysis')
        const clusterJob = jobs.find(j => j.job_type === 'clustering')

        if (clusterJob?.status === 'done' || clusterJob?.status === 'completed') {
            phase = 'done'
            progress = 100
        } else if (clusterJob?.status === 'running' || (intentJob?.status === 'done' || intentJob?.status === 'completed')) {
            phase = 'clustering'
            progress = 70 + Math.round((clusterJob?.progress_percent ?? 0) * 0.3)
        } else if (intentJob?.status === 'running' || (serpJob?.status === 'done' || serpJob?.status === 'completed')) {
            phase = 'intent_analysis'
            progress = 35 + Math.round((intentJob?.progress_percent ?? 0) * 0.35)
        } else {
            phase = 'serp_fetch'
            progress = Math.round((serpJob?.progress_percent ?? 0) * 0.35)
        }
    }

    // Or derive from run record directly
    const runStatus = run.status as string
    const isDone = runStatus === 'done' || runStatus === 'completed' || phase === 'done'
    const isFailed = runStatus === 'failed' || runStatus === 'error'

    return NextResponse.json({
        status: isFailed ? 'failed' : isDone ? 'done' : 'running',
        phase,
        progress: isDone ? 100 : progress,
        total_keywords: run.total_keywords,
        processed_keywords: run.processed_keywords,
    })
}
