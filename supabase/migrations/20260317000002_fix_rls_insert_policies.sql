-- Fix missing RLS INSERT/UPDATE policies for analysis tables
-- The original Sprint 1 migration (20260317000000) only added SELECT policies.
-- These INSERT policies are required for the /api/datasets/[id]/analyze route to work.

-- ============================================================
-- analysis_jobs: Owners and editors can create jobs
-- (already exists in migration but may not have been applied — add IF NOT EXISTS logic)
-- We use a DO block to avoid errors if already exists
-- ============================================================
DO $$
BEGIN
  -- analysis_jobs INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'analysis_jobs'
      AND policyname = 'Owners and editors can create jobs'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Owners and editors can create jobs"
      ON public.analysis_jobs FOR INSERT
      WITH CHECK (
          EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
          EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = analysis_jobs.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
      )
    $pol$;
  END IF;

  -- intent_analysis_runs INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'intent_analysis_runs'
      AND policyname = 'Owners and editors can create analysis runs'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Owners and editors can create analysis runs"
      ON public.intent_analysis_runs FOR INSERT
      WITH CHECK (
          EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
          EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = intent_analysis_runs.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
      )
    $pol$;
  END IF;

  -- intent_analysis_runs UPDATE (worker needs to update status/progress)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'intent_analysis_runs'
      AND policyname = 'Owners and editors can update analysis runs'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Owners and editors can update analysis runs"
      ON public.intent_analysis_runs FOR UPDATE
      USING (public.has_workspace_access(workspace_id))
    $pol$;
  END IF;

  -- analysis_jobs UPDATE (full — worker updates status/progress)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'analysis_jobs'
      AND policyname = 'Workers can update jobs'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Workers can update jobs"
      ON public.analysis_jobs FOR UPDATE
      USING (public.has_workspace_access(workspace_id))
    $pol$;
  END IF;

END $$;
