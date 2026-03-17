// Shared TypeScript types for the Worker

export type JobType = 'translation' | 'serp_fetch' | 'intent_analysis' | 'clustering'
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface AnalysisJob {
  id: string
  workspace_id: string
  dataset_id: string
  job_type: JobType
  status: JobStatus
  priority: number
  payload: Record<string, unknown>
  progress_percent: number
  processed_count: number
  total_count: number
  error_message: string | null
  retry_count: number
  max_retries: number
  locked_by: string | null
  locked_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface TranslationPayload {
  keyword_ids: string[]  // IDs of keywords to translate
  dataset_id: string
}

export interface WorkerConfig {
  workerId: string
  pollIntervalMs: number
  stallRecoveryMinutes: number
}
