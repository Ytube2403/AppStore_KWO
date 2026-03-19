-- ============================================================
-- Semantic Clustering: schema extensions
-- Date: 2026-03-19
-- ============================================================

-- 1. Add manual override flag to memberships
ALTER TABLE public.keyword_cluster_memberships
  ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. RLS: allow workspace members to UPDATE memberships (move keywords)
CREATE POLICY "Members can update cluster memberships"
ON public.keyword_cluster_memberships FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.keyword_clusters kc
        WHERE kc.id = cluster_id AND public.has_workspace_access(kc.workspace_id)
    )
);

-- 3. RLS: allow workspace members to DELETE memberships (remove keywords)
CREATE POLICY "Members can delete cluster memberships"
ON public.keyword_cluster_memberships FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.keyword_clusters kc
        WHERE kc.id = cluster_id AND public.has_workspace_access(kc.workspace_id)
    )
);

-- 4. RLS: allow workspace members to INSERT memberships (move target)
CREATE POLICY "Members can insert cluster memberships"
ON public.keyword_cluster_memberships FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.keyword_clusters kc
        WHERE kc.id = cluster_id AND public.has_workspace_access(kc.workspace_id)
    )
);

-- 5. RLS: allow workspace members to UPDATE cluster metadata (keyword_count)
CREATE POLICY "Members can update clusters"
ON public.keyword_clusters FOR UPDATE
USING (public.has_workspace_access(workspace_id));
