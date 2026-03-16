import { createClient } from '@/utils/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ImportModal from './import-modal'
import WorkspaceDetailClient from './workspace-detail-client'

export default async function WorkspaceDetail({
    params,
}: {
    params: Promise<{ workspaceId: string }>
}) {
    const resolvedParams = await params
    const workspaceId = resolvedParams.workspaceId
    const supabase = await createClient()

    const { data: datasets } = await supabase
        .from('datasets')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })

    return (
        <div className="container mx-auto max-w-5xl py-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Datasets</h1>
                    <p className="text-muted-foreground">Manage files and keyword analysis data</p>
                </div>
                <ImportModal workspaceId={workspaceId} />
            </div>

            <WorkspaceDetailClient datasets={datasets || []} workspaceId={workspaceId} />

        </div>
    )
}
