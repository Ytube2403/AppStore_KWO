-- Migration: Extend serp_snapshots to support run-based SERP storage
-- Adds run_id, top_apps, and store columns needed by the serp-fetch worker

ALTER TABLE public.serp_snapshots
    ADD COLUMN IF NOT EXISTS run_id  UUID REFERENCES public.intent_analysis_runs(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS top_apps JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS store   TEXT NOT NULL DEFAULT 'apple' CHECK (store IN ('apple', 'google_play'));

-- Unique constraint for upsert conflict resolution in serp-fetch worker
ALTER TABLE public.serp_snapshots
    DROP CONSTRAINT IF EXISTS serp_snapshots_keyword_run_unique;

ALTER TABLE public.serp_snapshots
    ADD CONSTRAINT serp_snapshots_keyword_run_unique UNIQUE (keyword_id, run_id);

-- Index for run-based lookups
CREATE INDEX IF NOT EXISTS idx_serp_snapshots_run_id ON public.serp_snapshots(run_id);

COMMENT ON COLUMN public.serp_snapshots.run_id   IS 'Analysis run that produced this snapshot';
COMMENT ON COLUMN public.serp_snapshots.top_apps IS 'Array of top-10 app objects {appId, name, position, score, free, developer}';
COMMENT ON COLUMN public.serp_snapshots.store    IS 'Store this snapshot was fetched from: apple or google_play';
