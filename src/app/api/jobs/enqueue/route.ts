import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

interface EnqueueBody {
  datasetId: string
  jobType: 'translation' | 'intent_analysis' | 'clustering'
  payload?: Record<string, unknown>
  priority?: number  // 1-10, lower = higher priority, default 5
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body: EnqueueBody = await request.json()
    const { datasetId, jobType, payload = {}, priority = 5 } = body

    if (!datasetId || !jobType) {
      return NextResponse.json({ error: 'datasetId and jobType are required' }, { status: 400 })
    }

    const validJobTypes = ['translation', 'intent_analysis', 'clustering']
    if (!validJobTypes.includes(jobType)) {
      return NextResponse.json({ error: `Invalid jobType. Must be one of: ${validJobTypes.join(', ')}` }, { status: 400 })
    }

    // Verify the user has access to this dataset's workspace
    const { data: dataset, error: datasetError } = await supabase
      .from('datasets')
      .select('id, workspace_id')
      .eq('id', datasetId)
      .single()

    if (datasetError || !dataset) {
      return NextResponse.json({ error: 'Dataset not found or access denied' }, { status: 404 })
    }

    // Create the job row
    const { data: job, error: insertError } = await supabase
      .from('analysis_jobs')
      .insert({
        workspace_id: dataset.workspace_id,
        dataset_id: datasetId,
        job_type: jobType,
        status: 'pending',
        priority: Math.max(1, Math.min(10, priority)),
        payload,
        progress_percent: 0,
        processed_count: 0,
        total_count: (payload as any).keyword_ids?.length ?? 0,
      })
      .select('id, status, created_at')
      .single()

    if (insertError || !job) {
      console.error('Failed to enqueue job:', insertError)
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      createdAt: job.created_at,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
