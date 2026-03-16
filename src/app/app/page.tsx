import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import CreateWorkspaceForm from './create-workspace-form'
import WorkspaceCard from './workspace-card'

export default async function AppDashboard() {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        redirect('/login')
    }

    // Fetch workspaces owned by user OR where user is a member
    // Handled by RLS, we just select * from workspaces
    const { data: workspaces } = await supabase
        .from('workspaces')
        .select('*')
        .order('created_at', { ascending: false })

    return (
        <div className="container mx-auto p-8 max-w-5xl">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
                    <p className="text-muted-foreground mt-1">Manage your ASO datasets and teams</p>
                </div>
                <div className="flex items-center gap-4">
                    <form action="/auth/signout" method="post">
                        <Button variant="outline" size="sm">Sign out</Button>
                    </form>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="flex flex-col border-dashed border-2 hover:border-solid transition-colors bg-muted/20">
                    <CardHeader>
                        <CardTitle className="text-xl">Create New</CardTitle>
                        <CardDescription>Start a new data workspace</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex items-center justify-center pt-0">
                        <CreateWorkspaceForm />
                    </CardContent>
                </Card>

                {workspaces?.map((ws) => (
                    <WorkspaceCard key={ws.id} workspace={ws} isOwner={ws.owner_id === user.id} />
                ))}
            </div>
        </div>
    )
}
