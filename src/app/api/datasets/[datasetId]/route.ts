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

