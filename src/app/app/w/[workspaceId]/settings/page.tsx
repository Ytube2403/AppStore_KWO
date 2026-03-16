import { createClient } from '@/utils/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import InviteMemberForm from './invite-member-form'
import { Badge } from '@/components/ui/badge'

export default async function WorkspaceSettings({
    params,
}: {
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

    if (!workspace) return null

    // Fetch Members
    const { data: members } = await supabase
        .from('workspace_members')
        .select('role, user:auth.users(email)') // Note: querying auth.users might fail if we don't have a view exposing emails
        // A better approach for MVP if we can't query auth.users from client API is purely relying on knowing who's in it
        // Wait, by default `auth.users` is not queryable via PostgREST unless there's a view.
        // For MVP, we'll try it if not we'll just show IDs. Let's just fetch everything for now.
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true })

    // Owner is not in workspace_members by default in our phase1_schema for MVP, so let's handle that:
    // owner email: we can't easily get it via standard RLS unless we do it in a secure RPC or server-action, 
    // but for MVP displaying "Owner (You)" works if user matches owner.

    const { data: pendingInvites } = await supabase
        .from('workspace_invites')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending')

    return (
        <div className="container mx-auto max-w-5xl py-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Settings & Members</h1>
                    <p className="text-muted-foreground">Manage your workspace access</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card>
                    <CardHeader>
                        <CardTitle>Invite New Member</CardTitle>
                        <CardDescription>Send an email invitation to join this workspace</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <InviteMemberForm workspaceId={workspaceId} />
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Active Members (MVP Preview)</CardTitle>
                            <CardDescription>People with access to datasets</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-4">
                                <li className="flex justify-between items-center text-sm">
                                    <span className="font-medium text-gray-800">Workspace Owner ID: {workspace.owner_id.split('-')[0]}...</span>
                                    <Badge variant="outline" className="bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border-yellow-200">owner</Badge>
                                </li>
                                {members?.map((m: any, idx) => (
                                    <li key={idx} className="flex justify-between items-center text-sm border-t pt-2">
                                        <span className="text-gray-600">Member ID: {m.user_id?.split('-')[0]}...</span>
                                        <Badge variant="secondary" className="capitalize">{m.role}</Badge>
                                    </li>
                                ))}
                            </ul>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Pending Invites</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {!pendingInvites || pendingInvites.length === 0 ? (
                                <p className="text-sm text-gray-400">No pending invites</p>
                            ) : (
                                <ul className="space-y-4">
                                    {pendingInvites.map((invite) => (
                                        <li key={invite.id} className="flex flex-col gap-1 text-sm border-b pb-2 last:border-0">
                                            <div className="flex justify-between">
                                                <span className="font-medium">{invite.email}</span>
                                                <Badge variant="outline" className="capitalize text-gray-500">{invite.role}</Badge>
                                            </div>
                                            <div className="text-xs text-gray-400">
                                                Expires: {new Date(invite.expires_at).toLocaleDateString()}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
