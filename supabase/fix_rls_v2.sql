-- Fix RLS Infinite Recursion & Insert Violation (V2)

-- 1. Helper Functions (Safely passing auth.uid() to bypass SECURITY DEFINER context issues)

-- Check if user is owner of workspace (Bypasses RLS recursively)
CREATE OR REPLACE FUNCTION public.is_workspace_owner(ws_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = ws_id AND owner_id = uid
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if user is an admin (owner or editor) of workspace
CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = ws_id AND owner_id = uid
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = ws_id AND user_id = uid AND role IN ('owner', 'editor')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if user has ANY access to workspace (owner, editor, viewer)
CREATE OR REPLACE FUNCTION public.has_workspace_access(ws_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = ws_id AND owner_id = uid
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = ws_id AND user_id = uid
  );
$$ LANGUAGE sql SECURITY DEFINER;


-- 2. Drop all previous potentially problematic policies
DROP POLICY IF EXISTS "Users can view workspaces they own or belong to" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Workspace owners can update their workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Workspace owners can delete their workspaces" ON public.workspaces;

DROP POLICY IF EXISTS "Users can view members of their workspaces" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can add members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can update members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can delete members" ON public.workspace_members;
DROP POLICY IF EXISTS "Users can remove themselves from a workspace" ON public.workspace_members;

DROP POLICY IF EXISTS "Owners and editors can create datasets" ON public.datasets;
DROP POLICY IF EXISTS "Owners and editors can update datasets" ON public.datasets;
DROP POLICY IF EXISTS "Owners and editors can delete datasets" ON public.datasets;
DROP POLICY IF EXISTS "Members can view datasets in their workspaces" ON public.datasets;

DROP POLICY IF EXISTS "Owners and editors can create keywords" ON public.keywords;
DROP POLICY IF EXISTS "Owners and editors can update keywords" ON public.keywords;
DROP POLICY IF EXISTS "Owners and editors can delete keywords" ON public.keywords;
DROP POLICY IF EXISTS "Members can view keywords in their workspaces" ON public.keywords;


-- 3. Re-apply Workspaces Policies
CREATE POLICY "workspaces_select" ON public.workspaces FOR SELECT 
USING (owner_id = auth.uid() OR EXISTS (
  SELECT 1 FROM public.workspace_members WHERE workspace_id = id AND user_id = auth.uid()
));

CREATE POLICY "workspaces_insert" ON public.workspaces FOR INSERT 
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "workspaces_update" ON public.workspaces FOR UPDATE 
USING (owner_id = auth.uid());

CREATE POLICY "workspaces_delete" ON public.workspaces FOR DELETE 
USING (owner_id = auth.uid());


-- 4. Re-apply Workspace Members Policies
CREATE POLICY "workspace_members_select" ON public.workspace_members FOR SELECT 
USING (user_id = auth.uid() OR public.is_workspace_owner(workspace_id, auth.uid()));

CREATE POLICY "workspace_members_insert" ON public.workspace_members FOR INSERT 
WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));

CREATE POLICY "workspace_members_update" ON public.workspace_members FOR UPDATE 
USING (public.is_workspace_owner(workspace_id, auth.uid()));

CREATE POLICY "workspace_members_delete" ON public.workspace_members FOR DELETE 
USING (public.is_workspace_owner(workspace_id, auth.uid()) OR user_id = auth.uid());


-- 5. Re-apply Dataset Policies
CREATE POLICY "datasets_select" ON public.datasets FOR SELECT 
USING (public.has_workspace_access(workspace_id, auth.uid()));

CREATE POLICY "datasets_insert" ON public.datasets FOR INSERT 
WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "datasets_update" ON public.datasets FOR UPDATE 
USING (public.is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "datasets_delete" ON public.datasets FOR DELETE 
USING (public.is_workspace_admin(workspace_id, auth.uid()));


-- 6. Re-apply Keyword Policies
CREATE POLICY "keywords_select" ON public.keywords FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.datasets d WHERE d.id = dataset_id AND public.has_workspace_access(d.workspace_id, auth.uid())
));

CREATE POLICY "keywords_insert" ON public.keywords FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.datasets d WHERE d.id = dataset_id AND public.is_workspace_admin(d.workspace_id, auth.uid())
));

CREATE POLICY "keywords_update" ON public.keywords FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM public.datasets d WHERE d.id = dataset_id AND public.is_workspace_admin(d.workspace_id, auth.uid())
));

CREATE POLICY "keywords_delete" ON public.keywords FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM public.datasets d WHERE d.id = dataset_id AND public.is_workspace_admin(d.workspace_id, auth.uid())
));

-- 7. Fix Presets Similarly
DROP POLICY IF EXISTS "Members can view presets in their workspaces" ON public.presets;
DROP POLICY IF EXISTS "Owners and editors can create presets" ON public.presets;
DROP POLICY IF EXISTS "Owners and editors can update presets" ON public.presets;
DROP POLICY IF EXISTS "Owners and editors can delete presets" ON public.presets;

CREATE POLICY "presets_select" ON public.presets FOR SELECT 
USING (public.has_workspace_access(workspace_id, auth.uid()));

CREATE POLICY "presets_insert" ON public.presets FOR INSERT 
WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "presets_update" ON public.presets FOR UPDATE 
USING (public.is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "presets_delete" ON public.presets FOR DELETE 
USING (public.is_workspace_admin(workspace_id, auth.uid()));
