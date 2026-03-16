-- Phase 1: Database Schema and RLS Policies for ASO Keyword Optimization
-- Run this in your Supabase SQL Editor

-- 1. Create Tables
CREATE TABLE public.workspaces (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE public.workspace_members (
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE public.workspace_invites (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')) DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    accepted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX unique_pending_invite ON public.workspace_invites (workspace_id, email) WHERE status = 'pending';

CREATE TABLE public.datasets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    source_filename TEXT,
    competitor_count INT DEFAULT 0,
    my_rank_column_name TEXT,
    competitor_column_names JSONB DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    platform TEXT,
    market TEXT,
    locale TEXT,
    snapshot_date DATE,
    source_tool TEXT,
    column_mapping JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE public.keywords (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dataset_id UUID REFERENCES public.datasets(id) ON DELETE CASCADE NOT NULL,
    keyword TEXT NOT NULL,
    volume NUMERIC,
    difficulty NUMERIC,
    kei NUMERIC,
    my_rank INT,
    competitor_ranks JSONB DEFAULT '{}'::jsonb,
    competitor_ranked_count INT DEFAULT 0,
    competitor_topN_count INT DEFAULT 0,
    competitor_best_rank INT,
    relevancy_score NUMERIC,
    total_score NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX idx_keywords_dataset_id ON public.keywords(dataset_id);
CREATE INDEX idx_keywords_dataset_id_score ON public.keywords(dataset_id, total_score DESC);
CREATE INDEX idx_keywords_dataset_id_volume ON public.keywords(dataset_id, volume);
CREATE INDEX idx_keywords_dataset_id_difficulty ON public.keywords(dataset_id, difficulty);
CREATE INDEX idx_keywords_dataset_id_kei ON public.keywords(dataset_id, kei);

CREATE TABLE public.presets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE public.selections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dataset_id UUID REFERENCES public.datasets(id) ON DELETE CASCADE NOT NULL,
    keyword_id UUID REFERENCES public.keywords(id) ON DELETE CASCADE NOT NULL,
    selected_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    tags JSONB DEFAULT '[]'::jsonb,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE(dataset_id, keyword_id, selected_by) -- Mode B: per-user selection
);

-- 2. Row Level Security (RLS) Enablement
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selections ENABLE ROW LEVEL SECURITY;


-- 3. RLS Policies

-- Helper function to check if user has access to a workspace
CREATE OR REPLACE FUNCTION public.has_workspace_access(param_workspace_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = param_workspace_id AND owner_id = auth.uid()
    UNION
    SELECT 1 FROM public.workspace_members WHERE workspace_id = param_workspace_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Workspaces
CREATE POLICY "Users can view workspaces they own or belong to" 
ON public.workspaces FOR SELECT 
USING (owner_id = auth.uid() OR id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can create workspaces" 
ON public.workspaces FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Workspace owners can update their workspaces" 
ON public.workspaces FOR UPDATE 
USING (owner_id = auth.uid());

CREATE POLICY "Workspace owners can delete their workspaces" 
ON public.workspaces FOR DELETE 
USING (owner_id = auth.uid());


-- Workspace Members
CREATE POLICY "Users can view members of their workspaces" 
ON public.workspace_members FOR SELECT 
USING (workspace_id IN (
    SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    UNION
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
));

CREATE POLICY "Owners can add members" 
ON public.workspace_members FOR INSERT 
WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = workspace_members.workspace_id AND user_id = auth.uid() AND role = 'owner')
);

CREATE POLICY "Owners can update members" 
ON public.workspace_members FOR UPDATE 
USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = workspace_members.workspace_id AND user_id = auth.uid() AND role = 'owner')
);

CREATE POLICY "Owners can delete members" 
ON public.workspace_members FOR DELETE 
USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = workspace_members.workspace_id AND user_id = auth.uid() AND role = 'owner')
);

CREATE POLICY "Users can remove themselves from a workspace"
ON public.workspace_members FOR DELETE
USING (user_id = auth.uid());


-- Workspace Invites
CREATE POLICY "Members can view invites for their workspaces" 
ON public.workspace_invites FOR SELECT 
USING (public.has_workspace_access(workspace_id));

CREATE POLICY "Owners and editors can create invites" 
ON public.workspace_invites FOR INSERT 
WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = workspace_invites.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);

CREATE POLICY "Owners and editors can update invites" 
ON public.workspace_invites FOR UPDATE 
USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = workspace_invites.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);

CREATE POLICY "Owners and editors can delete invites" 
ON public.workspace_invites FOR DELETE 
USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = workspace_invites.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);


-- Datasets
CREATE POLICY "Members can view datasets in their workspaces" 
ON public.datasets FOR SELECT 
USING (public.has_workspace_access(workspace_id));

CREATE POLICY "Owners and editors can create datasets" 
ON public.datasets FOR INSERT 
WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = datasets.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);

CREATE POLICY "Owners and editors can update datasets" 
ON public.datasets FOR UPDATE 
USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = datasets.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);

CREATE POLICY "Owners and editors can delete datasets" 
ON public.datasets FOR DELETE 
USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = datasets.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);

-- Keywords
CREATE POLICY "Members can view keywords in their workspaces" 
ON public.keywords FOR SELECT 
USING (
    EXISTS (SELECT 1 FROM public.datasets WHERE id = dataset_id AND public.has_workspace_access(workspace_id))
);

CREATE POLICY "Owners and editors can create keywords" 
ON public.keywords FOR INSERT 
WITH CHECK (
    EXISTS (SELECT 1 FROM public.datasets d JOIN public.workspace_members wm ON d.workspace_id = wm.workspace_id WHERE d.id = dataset_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'editor')) OR
    EXISTS (SELECT 1 FROM public.datasets d JOIN public.workspaces w ON d.workspace_id = w.id WHERE d.id = dataset_id AND w.owner_id = auth.uid())
);

CREATE POLICY "Owners and editors can update keywords" 
ON public.keywords FOR UPDATE 
USING (
    EXISTS (SELECT 1 FROM public.datasets d JOIN public.workspace_members wm ON d.workspace_id = wm.workspace_id WHERE d.id = dataset_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'editor')) OR
    EXISTS (SELECT 1 FROM public.datasets d JOIN public.workspaces w ON d.workspace_id = w.id WHERE d.id = dataset_id AND w.owner_id = auth.uid())
);

CREATE POLICY "Owners and editors can delete keywords" 
ON public.keywords FOR DELETE 
USING (
    EXISTS (SELECT 1 FROM public.datasets d JOIN public.workspace_members wm ON d.workspace_id = wm.workspace_id WHERE d.id = dataset_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'editor')) OR
    EXISTS (SELECT 1 FROM public.datasets d JOIN public.workspaces w ON d.workspace_id = w.id WHERE d.id = dataset_id AND w.owner_id = auth.uid())
);


-- Presets
CREATE POLICY "Members can view presets in their workspaces" 
ON public.presets FOR SELECT 
USING (public.has_workspace_access(workspace_id));

CREATE POLICY "Owners and editors can create presets" 
ON public.presets FOR INSERT 
WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = presets.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);

CREATE POLICY "Owners and editors can update presets" 
ON public.presets FOR UPDATE 
USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = presets.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);

CREATE POLICY "Owners and editors can delete presets" 
ON public.presets FOR DELETE 
USING (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = presets.workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor'))
);


-- Selections
CREATE POLICY "Members can view selections in their workspaces" 
ON public.selections FOR SELECT 
USING (
    EXISTS (SELECT 1 FROM public.datasets WHERE id = dataset_id AND public.has_workspace_access(workspace_id))
);

CREATE POLICY "Users can create their own selections" 
ON public.selections FOR INSERT 
WITH CHECK (
    selected_by = auth.uid() AND 
    EXISTS (SELECT 1 FROM public.datasets WHERE id = dataset_id AND public.has_workspace_access(workspace_id))
);

CREATE POLICY "Users can update their own selections" 
ON public.selections FOR UPDATE 
USING (selected_by = auth.uid());

CREATE POLICY "Users can delete their own selections" 
ON public.selections FOR DELETE 
USING (selected_by = auth.uid());

-- Optional: Allow owners/editors to delete any selection (if needed)
-- CREATE POLICY "Owners and editors can delete any selection" 
-- ON public.selections FOR DELETE 
-- USING (
--    EXISTS (SELECT 1 FROM public.datasets d JOIN public.workspace_members wm ON d.workspace_id = wm.workspace_id WHERE d.id = dataset_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'editor')) OR
--    EXISTS (SELECT 1 FROM public.datasets d JOIN public.workspaces w ON d.workspace_id = w.id WHERE d.id = dataset_id AND w.owner_id = auth.uid())
-- );
