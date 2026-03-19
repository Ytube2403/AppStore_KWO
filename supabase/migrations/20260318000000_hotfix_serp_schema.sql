-- ============================================================
-- Sprint 3 Hotfix: Fix schema issues for SERP + Intent Analysis
-- Date: 2026-03-18
-- ============================================================

-- 1. Add run_id to serp_snapshots (required for per-run SERP lookup)
ALTER TABLE public.serp_snapshots
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.intent_analysis_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS store TEXT DEFAULT 'apple',
  ADD COLUMN IF NOT EXISTS top_apps JSONB NOT NULL DEFAULT '[]',
  -- rename snapshot_data → keep for backward compat but top_apps is primary
  ALTER COLUMN snapshot_data SET DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_serp_snapshots_run_id ON public.serp_snapshots(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_serp_snapshots_keyword_run ON public.serp_snapshots(keyword_id, run_id)
  WHERE run_id IS NOT NULL;

-- 2. Allow serp_fetch job type in analysis_jobs
ALTER TABLE public.analysis_jobs
  DROP CONSTRAINT IF EXISTS analysis_jobs_job_type_check;

ALTER TABLE public.analysis_jobs
  ADD CONSTRAINT analysis_jobs_job_type_check
  CHECK (job_type IN ('translation', 'serp_fetch', 'intent_analysis', 'clustering'));

-- 3. Update model_used default to reflect OpenRouter
ALTER TABLE public.intent_analysis_runs
  ALTER COLUMN model_used SET DEFAULT 'minimax/minimax-m2.5:free';
