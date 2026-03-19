import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/datasets/[datasetId]/clusters/move
 * Move a keyword from one cluster to another.
 *
 * Body: { keyword_id, from_cluster_id, to_cluster_id }
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ datasetId: string }> }
) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { datasetId } = await params
    const body = await req.json()
    const { keyword_id, from_cluster_id, to_cluster_id } = body

    if (!keyword_id || !from_cluster_id || !to_cluster_id) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (from_cluster_id === to_cluster_id) {
        return NextResponse.json({ error: 'Source and target cluster are the same' }, { status: 400 })
    }

    // Verify both clusters belong to this dataset
    const { data: clusters } = await supabase
        .from('keyword_clusters')
        .select('id, keyword_count')
        .eq('dataset_id', datasetId)
        .in('id', [from_cluster_id, to_cluster_id])

    if (!clusters || clusters.length !== 2) {
        return NextResponse.json({ error: 'Invalid cluster IDs' }, { status: 400 })
    }

    // 1. Delete old membership
    const { error: delErr } = await supabase
        .from('keyword_cluster_memberships')
        .delete()
        .eq('cluster_id', from_cluster_id)
        .eq('keyword_id', keyword_id)

    if (delErr) {
        return NextResponse.json({ error: `Failed to remove from source: ${delErr.message}` }, { status: 500 })
    }

    // 2. Insert new membership with manual override flag
    const { error: insErr } = await supabase
        .from('keyword_cluster_memberships')
        .insert({
            cluster_id: to_cluster_id,
            keyword_id,
            is_manual_override: true,
        })

    if (insErr) {
        return NextResponse.json({ error: `Failed to add to target: ${insErr.message}` }, { status: 500 })
    }

    // 3. Update keyword_count on both clusters
    const fromCluster = clusters.find(c => c.id === from_cluster_id)
    const toCluster = clusters.find(c => c.id === to_cluster_id)

    await supabase
        .from('keyword_clusters')
        .update({ keyword_count: Math.max(0, (fromCluster?.keyword_count || 1) - 1) })
        .eq('id', from_cluster_id)

    await supabase
        .from('keyword_clusters')
        .update({ keyword_count: (toCluster?.keyword_count || 0) + 1 })
        .eq('id', to_cluster_id)

    // 4. Update cluster_id on intent results
    await supabase
        .from('keyword_intent_results')
        .update({ cluster_id: to_cluster_id })
        .eq('keyword_id', keyword_id)
        .eq('dataset_id', datasetId)

    return NextResponse.json({ success: true })
}
