import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })

    const { data: presets, error } = await supabase
        .from('presets')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ presets })
}

export async function POST(request: Request) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { workspaceId, name, config } = await request.json()

        // Validate
        if (!workspaceId || !name || !config) {
            return NextResponse.json({ error: 'Missing requested fields' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('presets')
            .insert([{
                workspace_id: workspaceId,
                name,
                config,
                created_by: user.id
            }])
            .select()
            .single()

        if (error) throw error

        return NextResponse.json({ success: true, preset: data })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
