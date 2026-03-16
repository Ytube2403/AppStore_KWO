'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export default function WorkspaceBreadcrumb({ workspaceName, workspaceId }: { workspaceName: string, workspaceId: string }) {
    const params = useParams()
    const datasetId = params.datasetId as string | undefined
    const [datasetName, setDatasetName] = useState<string | null>(null)

    useEffect(() => {
        if (datasetId) {
            const supabase = createClient()
            supabase.from('datasets').select('name').eq('id', datasetId).single().then(({ data }) => {
                if (data) setDatasetName(data.name)
            })
        } else {
            setDatasetName(null)
        }
    }, [datasetId])

    return (
        <h2 className="font-semibold text-sm flex items-center gap-1.5 whitespace-nowrap">
            <Link href="/app" className="text-muted-foreground hover:text-black transition-colors">Workspace</Link>
            <span className="text-muted-foreground">/</span>
            {datasetId ? (
                <>
                    <Link href={`/app/w/${workspaceId}`} className="text-muted-foreground hover:text-black transition-colors">{workspaceName}</Link>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-black max-w-[150px] md:max-w-xs truncate">{datasetName || '...'}</span>
                </>
            ) : (
                <span className="text-black max-w-[150px] md:max-w-xs truncate">{workspaceName}</span>
            )}
        </h2>
    )
}
