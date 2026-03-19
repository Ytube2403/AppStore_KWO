import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/datasets/[datasetId]/clusters/remove
 * Remove a keyword from its cluster.
 *
 * Body: { keyword_id, cluster_id }
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
    const { keyword_id, cluster_id } = body

    if (!keyword_id || !cluster_id) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify cluster belongs to this dataset
    const { data: cluster } = await supabase
        .from('keyword_clusters')
        .select('id, keyword_count')
        .eq('id', cluster_id)
        .eq('dataset_id', datasetId)
        .single()

    if (!cluster) {
        return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }

    // 1. Delete membership
    const { error: delErr } = await supabase
        .from('keyword_cluster_memberships')
        .delete()
        .eq('cluster_id', cluster_id)
        .eq('keyword_id', keyword_id)

    if (delErr) {
        return NextResponse.json({ error: `Failed to remove: ${delErr.message}` }, { status: 500 })
    }

    // 2. Decrement keyword_count
    await supabase
        .from('keyword_clusters')
        .update({ keyword_count: Math.max(0, (cluster.keyword_count || 1) - 1) })
        .eq('id', cluster_id)

    // 3. Clear cluster_id from intent results
    await supabase
        .from('keyword_intent_results')
        .update({ cluster_id: null })
        .eq('keyword_id', keyword_id)
        .eq('dataset_id', datasetId)

    return NextResponse.json({ success: true })
}
