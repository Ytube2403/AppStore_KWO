-- ============================================================
-- Sprint 1: Worker Infrastructure & Intent Clusters Schema
-- Date: 2026-03-17
-- ============================================================

-- ============================================================
-- 1. Extend datasets table
-- ============================================================
ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS target_app_url TEXT,
  ADD COLUMN IF NOT EXISTS target_app_profile JSONB;

-- ============================================================
-- 2. global_app_profiles (semantic cache — no RLS, public data)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.global_app_profiles (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    app_url       TEXT NOT NULL UNIQUE,             -- canonical normalized URL
    profile_data  JSONB NOT NULL DEFAULT '{}',       -- LLM-extracted semantic data
    source        TEXT DEFAULT 'gemini',
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_app_profiles_app_url ON public.global_app_profiles(app_url);
CREATE INDEX IF NOT EXISTS idx_global_app_profiles_expires_at ON public.global_app_profiles(expires_at);

-- ============================================================
-- 3. analysis_jobs (main Worker job queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.analysis_jobs (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    dataset_id       UUID REFERENCES public.datasets(id) ON DELETE CASCADE NOT NULL,
    job_type         TEXT NOT NULL CHECK (job_type IN ('translation', 'intent_analysis', 'clustering')),
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    priority         INT NOT NULL DEFAULT 5,          -- lower = higher priority
    payload          JSONB NOT NULL DEFAULT '{}',     -- input params (e.g. keywordIds, options)
    progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    processed_count  INT NOT NULL DEFAULT 0,          -- keywords processed so far (resumability)
    total_count      INT NOT NULL DEFAULT 0,          -- total keywords to process
    error_message    TEXT,                            -- last error
    retry_count      INT NOT NULL DEFAULT 0,
    max_retries      INT NOT NULL DEFAULT 3,
    locked_by        TEXT,                            -- Worker ID that holds the lock
    locked_at        TIMESTAMPTZ,                     -- when the lock was acquired
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for Worker poll query
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status_priority ON public.analysis_jobs(status, priority ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_dataset_id ON public.analysis_jobs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_workspace_id ON public.analysis_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_locked_at ON public.analysis_jobs(locked_at) WHERE status = 'processing';

-- ============================================================
-- 4. intent_analysis_runs (per-run progress tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.intent_analysis_runs (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_id              UUID REFERENCES public.analysis_jobs(id) ON DELETE CASCADE NOT NULL,
    dataset_id          UUID REFERENCES public.datasets(id) ON DELETE CASCADE NOT NULL,
    workspace_id        UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    app_profile         JSONB,                        -- app profile snapshot used for this run
    total_keywords      INT NOT NULL DEFAULT 0,
    processed_keywords  INT NOT NULL DEFAULT 0,
    qualified_keywords  INT NOT NULL DEFAULT 0,       -- passed quality gate
    chunk_size          INT NOT NULL DEFAULT 50,
    model_used          TEXT DEFAULT 'gemini-3.1-flash-lite-preview',
    status              TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'completed', 'failed')),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intent_runs_dataset_id ON public.intent_analysis_runs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_intent_runs_job_id ON public.intent_analysis_runs(job_id);

-- ============================================================
-- 5. keyword_intent_results (per-keyword LLM output — Sprint 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.keyword_intent_results (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id          UUID REFERENCES public.intent_analysis_runs(id) ON DELETE CASCADE NOT NULL,
    keyword_id      UUID REFERENCES public.keywords(id) ON DELETE CASCADE NOT NULL,
    dataset_id      UUID REFERENCES public.datasets(id) ON DELETE CASCADE NOT NULL,
    -- Intent classification
    primary_intent  TEXT,                             -- e.g. 'brand', 'generic', 'competitor'
    sub_intent      TEXT,
    intent_score    NUMERIC(5,2),                     -- 0-100 confidence
    -- Raw LLM output
    raw_output      JSONB,
    -- Quality gate
    is_qualified    BOOLEAN NOT NULL DEFAULT TRUE,
    disqualify_reason TEXT,
    -- Cluster assignment (filled in Sprint 3)
    cluster_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(run_id, keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_intent_results_run_id ON public.keyword_intent_results(run_id);
CREATE INDEX IF NOT EXISTS idx_intent_results_dataset_id ON public.keyword_intent_results(dataset_id);
CREATE INDEX IF NOT EXISTS idx_intent_results_primary_intent ON public.keyword_intent_results(primary_intent);

-- ============================================================
-- 6. keyword_clusters (cluster definitions — Sprint 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.keyword_clusters (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id          UUID REFERENCES public.intent_analysis_runs(id) ON DELETE CASCADE NOT NULL,
    dataset_id      UUID REFERENCES public.datasets(id) ON DELETE CASCADE NOT NULL,
    workspace_id    UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    cluster_name    TEXT NOT NULL,
    cluster_theme   TEXT,
    cluster_intent  TEXT,
    keyword_count   INT NOT NULL DEFAULT 0,
    avg_score       NUMERIC(5,2),
    max_score       NUMERIC(5,2),
    -- Ranking signal
    opportunity_rank INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clusters_dataset_id ON public.keyword_clusters(dataset_id);
CREATE INDEX IF NOT EXISTS idx_clusters_run_id ON public.keyword_clusters(run_id);

-- ============================================================
-- 7. keyword_cluster_memberships (M:N join — Sprint 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.keyword_cluster_memberships (
    cluster_id      UUID REFERENCES public.keyword_clusters(id) ON DELETE CASCADE NOT NULL,
    keyword_id      UUID REFERENCES public.keywords(id) ON DELETE CASCADE NOT NULL,
    result_id       UUID REFERENCES public.keyword_intent_results(id) ON DELETE CASCADE,
    similarity_score NUMERIC(5,4),                    -- Jaccard similarity used in clustering
    PRIMARY KEY (cluster_id, keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_memberships_keyword_id ON public.keyword_cluster_memberships(keyword_id);

-- ============================================================
-- 8. serp_snapshots (optional SERP data — Sprint 4+)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.serp_snapshots (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    keyword_id      UUID REFERENCES public.keywords(id) ON DELETE CASCADE NOT NULL,
    dataset_id      UUID REFERENCES public.datasets(id) ON DELETE CASCADE NOT NULL,
    market          TEXT,
    snapshot_data   JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_serp_snapshots_keyword_id ON public.serp_snapshots(keyword_id);
CREATE INDEX IF NOT EXISTS idx_serp_snapshots_expires_at ON public.serp_snapshots(expires_at);

-- ============================================================
-- 9. updated_at auto-update triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER analysis_jobs_updated_at
  BEFORE UPDATE ON public.analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER global_app_profiles_updated_at
  BEFORE UPDATE ON public.global_app_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 10. RPC: pick_next_job (FOR UPDATE SKIP LOCKED — race-condition safe)
--     Called by Worker to atomically claim a pending job.
-- ============================================================
CREATE OR REPLACE FUNCTION public.pick_next_job(p_worker_id TEXT)
RETURNS SETOF public.analysis_jobs AS $$
  UPDATE public.analysis_jobs
  SET
    status    = 'processing',
    locked_by = p_worker_id,
    locked_at = NOW(),
    updated_at = NOW()
  WHERE id = (
    SELECT id
    FROM public.analysis_jobs
    WHERE
      status = 'pending'
      AND retry_count < max_retries
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql VOLATILE SECURITY DEFINER;

-- ============================================================
-- 11. RPC: recover_stalled_jobs
--     Called by Worker on startup and every 10 minutes.
--     Resets jobs locked for > 10 minutes (crashed Worker).
-- ============================================================
CREATE OR REPLACE FUNCTION public.recover_stalled_jobs(p_stall_minutes INT DEFAULT 10)
RETURNS INT AS $$
DECLARE
  recovered INT;
BEGIN
  UPDATE public.analysis_jobs
  SET
    status     = 'pending',
    locked_by  = NULL,
    locked_at  = NULL,
    retry_count = retry_count + 1,
    updated_at  = NOW()
  WHERE
    status     = 'processing'
    AND locked_at < NOW() - (p_stall_minutes || ' minutes')::INTERVAL
    AND retry_count < max_retries;

  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark jobs that have exhausted retries as failed
CREATE OR REPLACE FUNCTION public.fail_exhausted_jobs()
RETURNS INT AS $$
DECLARE
  failed_count INT;
BEGIN
  UPDATE public.analysis_jobs
  SET
    status        = 'failed',
    locked_by     = NULL,
    locked_at     = NULL,
    error_message = COALESCE(error_message, 'Max retries exceeded'),
    updated_at    = NOW()
  WHERE
    status     = 'processing'
    AND retry_count >= max_retries
    AND locked_at < NOW() - INTERVAL '10 minutes';

  GET DIAGNOSTICS failed_count = ROW_COUNT;
  RETURN failed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. RLS Policies
-- ============================================================

-- analysis_jobs: workspace members can read their own jobs
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their workspace jobs"
ON public.analysis_jobs FOR SELECT
USING (public.has_workspace_access(workspace_id));

CREATE POLICY "Owners and editors can create jobs"
ON public.analysis_jobs FOR INSERT
WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = analysis_jobs.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);

CREATE POLICY "Owners and editors can cancel jobs"
ON public.analysis_jobs FOR UPDATE
USING (
    public.has_workspace_access(workspace_id)
    AND status IN ('pending', 'failed')  -- can only cancel pending or failed jobs
);

-- intent_analysis_runs: readable by workspace members
ALTER TABLE public.intent_analysis_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their workspace runs"
ON public.intent_analysis_runs FOR SELECT
USING (public.has_workspace_access(workspace_id));

-- keyword_intent_results: readable by workspace members (via dataset)
ALTER TABLE public.keyword_intent_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view intent results in their workspace"
ON public.keyword_intent_results FOR SELECT
USING (
    EXISTS (SELECT 1 FROM public.datasets WHERE id = dataset_id AND public.has_workspace_access(workspace_id))
);

-- keyword_clusters: readable by workspace members
ALTER TABLE public.keyword_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view clusters in their workspace"
ON public.keyword_clusters FOR SELECT
USING (public.has_workspace_access(workspace_id));

-- keyword_cluster_memberships: readable via keyword has_workspace_access
ALTER TABLE public.keyword_cluster_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view cluster memberships in their workspace"
ON public.keyword_cluster_memberships FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.keyword_clusters kc
        WHERE kc.id = cluster_id AND public.has_workspace_access(kc.workspace_id)
    )
);

-- serp_snapshots: readable by workspace members
ALTER TABLE public.serp_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view SERP snapshots in their workspace"
ON public.serp_snapshots FOR SELECT
USING (
    EXISTS (SELECT 1 FROM public.datasets WHERE id = dataset_id AND public.has_workspace_access(workspace_id))
);

-- global_app_profiles: no RLS (global read, Worker writes via service role)
-- Note: Only Worker (service role) should INSERT/UPDATE. Frontend only reads via API.
ALTER TABLE public.global_app_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read app profiles"
ON public.global_app_profiles FOR SELECT
USING (true);

-- No INSERT/UPDATE policies for global_app_profiles — Worker uses service role key (bypasses RLS)
