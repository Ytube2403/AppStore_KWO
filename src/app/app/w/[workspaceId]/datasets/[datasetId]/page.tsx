import { createClient } from '@/utils/supabase/server'
import { notFound } from 'next/navigation'
import DatasetClientView from './client-view'

export default async function DatasetPage({
    params,
}: {
    params: Promise<{ workspaceId: string, datasetId: string }>
}) {
    const resolvedParams = await params
    const { workspaceId, datasetId } = resolvedParams
    const supabase = await createClient()

    // Verify dataset access
    const { data: dataset } = await supabase
        .from('datasets')
        .select('*')
        .eq('id', datasetId)
        .eq('workspace_id', workspaceId)
        .single()

    if (!dataset) return notFound()

    return (
        <div className="flex flex-col h-full w-full bg-gray-50 flex-1 overflow-hidden">
            <DatasetClientView dataset={dataset} workspaceId={workspaceId} />
        </div>
    )
}
