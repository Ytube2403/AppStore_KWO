import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
    const { workspaceId } = await params
    const body = await request.json()
    const supabase = await createClient()

    if (!body.name || body.name.trim() === '') {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    }

    // Check if user is owner
    const { data: { user } } = await supabase.auth.getUser()
    const { data: workspace } = await supabase
        .from('workspaces')
        .select('owner_id')
        .eq('id', workspaceId)
        .single()

    if (workspace?.owner_id !== user?.id) {
        return NextResponse.json({ error: 'Only owners can edit workspace' }, { status: 403 })
    }

    const { error } = await supabase
        .from('workspaces')
        .update({ name: body.name.trim() })
        .eq('id', workspaceId)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, name: body.name.trim() })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
    const { workspaceId } = await params
    const supabase = await createClient()

    // Check if user is owner
    const { data: { user } } = await supabase.auth.getUser()
    const { data: workspace } = await supabase
        .from('workspaces')
        .select('owner_id')
        .eq('id', workspaceId)
        .single()

    if (workspace?.owner_id !== user?.id) {
        return NextResponse.json({ error: 'Only owners can delete workspace' }, { status: 403 })
    }

    const { error } = await supabase
        .from('workspaces')
        .delete()
        .eq('id', workspaceId)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
