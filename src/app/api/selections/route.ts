import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

// Fetch selections for a dataset
export async function GET(request: Request) {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const datasetId = searchParams.get('datasetId')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!datasetId) return NextResponse.json({ error: 'Missing datasetId' }, { status: 400 })

    const { data: selections, error } = await supabase
        .from('selections')
        .select('*')
        .eq('dataset_id', datasetId)
        .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ selections })
}

// Bulk Upsert selections / notes / tags
export async function POST(request: Request) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { datasetId, updates } = await request.json()
        // updates is array: { keyword_id, is_selected, note, tags }

        if (!datasetId || !updates || !Array.isArray(updates)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
        }

        const upsertPayload = updates.map(u => ({
            user_id: user.id,
            dataset_id: datasetId,
            keyword_id: u.keyword_id,
            is_selected: typeof u.is_selected === 'boolean' ? u.is_selected : true,
            note: u.note || null,
            tags: u.tags || []
        }))

        const { error } = await supabase
            .from('selections')
            .upsert(upsertPayload, { onConflict: 'user_id,keyword_id' })

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
