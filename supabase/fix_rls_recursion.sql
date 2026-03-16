-- Fix for Infinite recursion detected in policy for relation "workspaces"
-- 1. Create a non-recursive SECURITY DEFINER function to get all workspaces a user has access to
CREATE OR REPLACE FUNCTION public.get_user_workspace_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM workspaces WHERE owner_id = auth.uid()
  UNION
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid();
$$;

-- 2. Drop the recursive SELECT policies
DROP POLICY IF EXISTS "Users can view workspaces they own or belong to" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view members of their workspaces" ON public.workspace_members;

-- 3. Recreate them using the non-recursive function
CREATE POLICY "Users can view workspaces they own or belong to" 
ON public.workspaces FOR SELECT 
USING (id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Users can view members of their workspaces" 
ON public.workspace_members FOR SELECT 
USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- 4. Update the has_workspace_access function to use this safe pattern too
CREATE OR REPLACE FUNCTION public.has_workspace_access(param_workspace_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN param_workspace_id IN (SELECT public.get_user_workspace_ids());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Fix Workspace Members UPDATE/INSERT policies
CREATE OR REPLACE FUNCTION public.is_workspace_owner(param_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspaces WHERE id = param_workspace_id AND owner_id = auth.uid()
    UNION
    SELECT 1 FROM workspace_members WHERE workspace_id = param_workspace_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

DROP POLICY IF EXISTS "Owners can add members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can update members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can delete members" ON public.workspace_members;

CREATE POLICY "Owners can add members" 
ON public.workspace_members FOR INSERT 
WITH CHECK (public.is_workspace_owner(workspace_id));

CREATE POLICY "Owners can update members" 
ON public.workspace_members FOR UPDATE 
USING (public.is_workspace_owner(workspace_id));

CREATE POLICY "Owners can delete members" 
ON public.workspace_members FOR DELETE 
USING (public.is_workspace_owner(workspace_id));


-- 6. Helper for editor/owner role for remaining tables
CREATE OR REPLACE FUNCTION public.is_workspace_admin(param_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspaces WHERE id = param_workspace_id AND owner_id = auth.uid()
    UNION
    SELECT 1 FROM workspace_members WHERE workspace_id = param_workspace_id AND user_id = auth.uid() AND role IN ('owner', 'editor')
  );
$$;

-- Fix Datasets
DROP POLICY IF EXISTS "Owners and editors can create datasets" ON public.datasets;
DROP POLICY IF EXISTS "Owners and editors can update datasets" ON public.datasets;
DROP POLICY IF EXISTS "Owners and editors can delete datasets" ON public.datasets;

CREATE POLICY "Owners and editors can create datasets" ON public.datasets FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY "Owners and editors can update datasets" ON public.datasets FOR UPDATE USING (public.is_workspace_admin(workspace_id));
CREATE POLICY "Owners and editors can delete datasets" ON public.datasets FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- Fix Keywords
DROP POLICY IF EXISTS "Owners and editors can create keywords" ON public.keywords;
DROP POLICY IF EXISTS "Owners and editors can update keywords" ON public.keywords;
DROP POLICY IF EXISTS "Owners and editors can delete keywords" ON public.keywords;

CREATE OR REPLACE FUNCTION public.is_dataset_admin(param_dataset_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_workspace_admin(workspace_id) FROM datasets WHERE id = param_dataset_id;
$$;

CREATE POLICY "Owners and editors can create keywords" ON public.keywords FOR INSERT WITH CHECK (public.is_dataset_admin(dataset_id));
CREATE POLICY "Owners and editors can update keywords" ON public.keywords FOR UPDATE USING (public.is_dataset_admin(dataset_id));
CREATE POLICY "Owners and editors can delete keywords" ON public.keywords FOR DELETE USING (public.is_dataset_admin(dataset_id));

-- Fix Presets
DROP POLICY IF EXISTS "Owners and editors can create presets" ON public.presets;
DROP POLICY IF EXISTS "Owners and editors can update presets" ON public.presets;
DROP POLICY IF EXISTS "Owners and editors can delete presets" ON public.presets;

CREATE POLICY "Owners and editors can create presets" ON public.presets FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY "Owners and editors can update presets" ON public.presets FOR UPDATE USING (public.is_workspace_admin(workspace_id));
CREATE POLICY "Owners and editors can delete presets" ON public.presets FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- Note: Selections already use simple auth.uid() checks or has_workspace_access, so they are fine!
