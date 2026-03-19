-- Fix analysis_jobs job_type CHECK constraint to include 'serp_fetch'
-- The original Sprint 1 migration was missing 'serp_fetch' from the allowed job types.

ALTER TABLE public.analysis_jobs
  DROP CONSTRAINT IF EXISTS analysis_jobs_job_type_check;

ALTER TABLE public.analysis_jobs
  ADD CONSTRAINT analysis_jobs_job_type_check
  CHECK (job_type IN ('translation', 'serp_fetch', 'intent_analysis', 'clustering'));
