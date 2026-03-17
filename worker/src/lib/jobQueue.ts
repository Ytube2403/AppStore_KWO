import { supabase } from './supabase'
import { logger } from './logger'
import type { AnalysisJob } from '../types'

const WORKER_ID = process.env.WORKER_ID || 'worker-1'
const STALL_MINUTES = parseInt(process.env.STALL_RECOVERY_MINUTES || '10', 10)

/**
 * Atomically claim the next pending job from the queue.
 * Uses FOR UPDATE SKIP LOCKED (via Supabase RPC) for race-condition safety.
 * Returns null if no jobs are available.
 */
export async function pickNextJob(): Promise<AnalysisJob | null> {
  const { data, error } = await supabase.rpc('pick_next_job', {
    p_worker_id: WORKER_ID,
  })

  if (error) {
    logger.error('Failed to pick next job', { error: error.message })
    return null
  }

  // RPC returns an array (SETOF) — take first row or null
  if (!data || data.length === 0) return null

  return data[0] as AnalysisJob
}

/**
 * Mark a job as completed.
 */
export async function markJobCompleted(jobId: string, processedCount: number): Promise<void> {
  const { error } = await supabase
    .from('analysis_jobs')
    .update({
      status: 'completed',
      progress_percent: 100,
      processed_count: processedCount,
      completed_at: new Date().toISOString(),
      locked_by: null,
      locked_at: null,
    })
    .eq('id', jobId)

  if (error) logger.error('Failed to mark job completed', { jobId, error: error.message })
}

/**
 * Mark a job as failed with an error message.
 * Increments retry_count. If retry_count >= max_retries, status becomes 'failed'.
 */
export async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  // Fetch current retry info
  const { data: job } = await supabase
    .from('analysis_jobs')
    .select('retry_count, max_retries')
    .eq('id', jobId)
    .single()

  if (!job) return

  const newRetryCount = job.retry_count + 1
  const exhausted = newRetryCount >= job.max_retries

  const { error } = await supabase
    .from('analysis_jobs')
    .update({
      status: exhausted ? 'failed' : 'pending',  // pending = will retry
      retry_count: newRetryCount,
      error_message: errorMessage,
      locked_by: null,
      locked_at: null,
    })
    .eq('id', jobId)

  if (error) logger.error('Failed to mark job failed', { jobId, error: error.message })

  if (exhausted) {
    logger.warn('Job exhausted all retries', { jobId, retries: newRetryCount })
  }
}

/**
 * Update progress on a running job (after each translated chunk).
 */
export async function updateJobProgress(
  jobId: string,
  processedCount: number,
  totalCount: number,
): Promise<void> {
  const progressPercent = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0

  const { error } = await supabase
    .from('analysis_jobs')
    .update({
      progress_percent: progressPercent,
      processed_count: processedCount,
      total_count: totalCount,
    })
    .eq('id', jobId)

  if (error) logger.error('Failed to update job progress', { jobId, error: error.message })
}

/**
 * Recover stalled jobs (Worker crashed while processing).
 * Resets jobs locked for > STALL_MINUTES back to 'pending' so they can be retried.
 * Should be called on Worker startup and periodically.
 */
export async function recoverStalledJobs(): Promise<void> {
  const { data, error } = await supabase.rpc('recover_stalled_jobs', {
    p_stall_minutes: STALL_MINUTES,
  })

  if (error) {
    logger.error('Failed to recover stalled jobs', { error: error.message })
    return
  }

  // data = recovered count (INT from the RPC)
  const count = data as number
  if (count > 0) {
    logger.info(`Recovered ${count} stalled job(s)`, { stall_minutes: STALL_MINUTES })
  }

  // Also fail exhausted jobs
  await supabase.rpc('fail_exhausted_jobs')
}
