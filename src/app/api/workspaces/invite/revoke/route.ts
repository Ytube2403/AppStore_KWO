import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    const supabase = await createClient()

    // 1. Authenticate Request
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { inviteId } = await request.json()

        if (!inviteId) {
            return NextResponse.json({ error: 'Missing inviteId' }, { status: 400 })
        }

        // Attempt to update the status to revoked
        // The RLS policy for workspace_invites UPDATE ensures only owner / editor can do this
        const { data: updatedInvite, error } = await supabase
            .from('workspace_invites')
            .update({ status: 'revoked' })
            .eq('id', inviteId)
            .eq('status', 'pending') // Only revoke pending
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: 'Unable to revoke. Check permissions or state.' }, { status: 400 })
        }

        return NextResponse.json({ success: true, invite: updatedInvite })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
