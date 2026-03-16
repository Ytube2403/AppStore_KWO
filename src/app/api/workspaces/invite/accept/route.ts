import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
    const supabase = await createClient()

    // 1. Authenticate Request
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        // If not logged in, redirect them to login first with ?next
        const loginUrl = new URL('/login', request.url)
        const currentUrl = new URL(request.url)
        const token = currentUrl.searchParams.get('token')
        if (token) {
            loginUrl.searchParams.set('next', `/api/workspaces/invite/accept?token=${token}`)
        }
        return NextResponse.redirect(loginUrl)
    }

    // 2. Parse token from URL
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
        return NextResponse.json({ error: 'Token is missing' }, { status: 400 })
    }

    // 3. Hash token to lookup in DB
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

    // Let's find the active matching invite
    const { data: invite, error: selectError } = await supabase
        .from('workspace_invites')
        .select('*')
        .eq('token_hash', hashedToken)
        .single()

    if (selectError || !invite) {
        return NextResponse.json({ error: 'Invalid or expired invite token' }, { status: 400 })
    }

    // 4. Validate Invite Criteria
    if (invite.status !== 'pending') {
        return NextResponse.json({ error: `Invite is already ${invite.status}` }, { status: 400 })
    }

    const expiresDate = new Date(invite.expires_at)
    if (new Date() > expiresDate) {
        // Note: To be fully diligent, we could mark it 'expired' here too.
        return NextResponse.json({ error: 'Invite has expired' }, { status: 400 })
    }

    // 5. Convert invite to Membership
    // This utilizes service role bypassing RLS since normal users might not have access to INSERT
    // members directly unless they happen to be the owner inserting themselves which is false here.
    // BUT Wait: The Phase 1 Spec says "Accept token -> tạo `workspace_members` đúng role".
    // The current user accepts it. Our RLS is:
    // "Owners can add members"
    // So a normal user accepting an invite CANNOT insert themselves directly through the normal client!

    // So we MUST use the Service Role bypass here to fulfill the invitation logic securely.
    const serviceRoleSupabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error: memberInsertError } = await serviceRoleSupabase
        .from('workspace_members')
        .insert([{
            workspace_id: invite.workspace_id,
            user_id: user.id,
            role: invite.role
        }])

    // Handle case where user is already member (duplicate)
    if (memberInsertError && !memberInsertError.message.includes('duplicate key')) {
        return NextResponse.json({ error: 'Failed to add member: ' + memberInsertError.message }, { status: 500 })
    }

    // 6. Update Invite status
    const { error: updateError } = await serviceRoleSupabase
        .from('workspace_invites')
        .update({
            status: 'accepted',
            accepted_at: new Date().toISOString()
        })
        .eq('id', invite.id)

    if (updateError) {
        return NextResponse.json({ error: 'Failed to update invite state' }, { status: 500 })
    }

    // 7. Redirect to the newly joined workspace!
    const targetUrl = new URL(`/app/w/${invite.workspace_id}`, request.url)
    return NextResponse.redirect(targetUrl)
}
