import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Settings, Database } from 'lucide-react'
import WorkspaceBackButton from './back-button'
import WorkspaceBreadcrumb from './workspace-breadcrumb'

export default async function WorkspaceLayout({
    children,
    params,
}: {
    children: React.ReactNode
    params: Promise<{ workspaceId: string }>
}) {
    const resolvedParams = await params
    const workspaceId = resolvedParams.workspaceId
    const supabase = await createClient()

    // Verify access (RLS handles this but if empty returned -> no access)
    const { data: workspace } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', workspaceId)
        .single()

    if (!workspace) {
        redirect('/app')
    }

    // Get current user role
    const { data: { user } } = await supabase.auth.getUser()
    const isOwner = workspace.owner_id === user?.id

    let role = 'viewer'
    if (isOwner) role = 'owner'
    else {
        const { data: member } = await supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', workspaceId)
            .eq('user_id', user?.id)
            .single()
        if (member) role = member.role
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Workspace Header Sub-Navigation */}
            <header className="border-b bg-white shrink-0">
                <div className="px-6 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0 pr-4">
                        <WorkspaceBackButton workspaceId={workspaceId} />
                        <WorkspaceBreadcrumb workspaceName={workspace.name} workspaceId={workspaceId} />
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 border text-gray-600 capitalize shrink-0">
                            {role}
                        </span>
                    </div>
                    <nav className="flex items-center gap-6 text-sm shrink-0">
                        <Link
                            href={`/app/w/${workspaceId}`}
                            className="flex items-center gap-2 text-muted-foreground hover:text-black transition-colors"
                        >
                            <Database className="h-4 w-4" /> Datasets
                        </Link>
                        <Link
                            href={`/app/w/${workspaceId}/settings`}
                            className="flex items-center gap-2 text-muted-foreground hover:text-black transition-colors"
                        >
                            <Settings className="h-4 w-4" /> Settings & Members
                        </Link>
                    </nav>
                </div>
            </header>

            {/* Workspace Content */}
            <main className="flex-1 bg-gray-50 flex flex-col overflow-hidden">
                {children}
            </main>
        </div>
    )
}
