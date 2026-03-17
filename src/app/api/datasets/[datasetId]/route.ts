import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ datasetId: string }> }) {
    const { datasetId } = await params
    const body = await request.json()
    const supabase = await createClient()

    if (!body.name || body.name.trim() === '') {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    }

    const updateData: any = { name: body.name.trim() }

    if (body.market !== undefined) {
        updateData.market = body.market.trim()
    }

    if (body.concept !== undefined) {
        updateData.concept = body.concept.trim()
    }

    if (body.target_app_url !== undefined) {
        const url = body.target_app_url.trim()
        if (url && !url.includes('apps.apple.com') && !url.includes('play.google.com')) {
            return NextResponse.json({ error: 'target_app_url must be an App Store or Google Play URL' }, { status: 400 })
        }
        updateData.target_app_url = url || null
        // Clear profile when URL changes so it gets re-generated
        updateData.target_app_profile = null
    }


    const { error } = await supabase
        .from('datasets')
        .update(updateData)
        .eq('id', datasetId)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, ...updateData })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ datasetId: string }> }) {
    const { datasetId } = await params
    const supabase = await createClient()

    const { error } = await supabase
        .from('datasets')
        .delete()
        .eq('id', datasetId)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}

