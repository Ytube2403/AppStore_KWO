import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

export async function POST(request: Request) {
    const supabase = await createClient()

    // 1. Authenticate Request
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse Body Object
    try {
        const { workspaceId, email, role } = await request.json()

        if (!workspaceId || !email || !role) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // 3. (Implicit) RLS Validation: Are we allowed to insert this invite?
        // Based on the Phase 1 schema, only owners and editors can create invites.
        // The RLS policy will automatically reject this insert if the user is a mere viewer.

        // 4. Generate Token & Hash
        const rawToken = crypto.randomBytes(32).toString('hex')
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

        // 5. Insert Invite Record
        // Typically, an invite expires in 7 days
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 7)

        const { data: insertedInvite, error: insertError } = await supabase
            .from('workspace_invites')
            .insert([
                {
                    workspace_id: workspaceId,
                    email,
                    role,
                    invited_by: user.id,
                    token_hash: tokenHash,
                    expires_at: expiresAt.toISOString(),
                    status: 'pending'
                }
            ])
            .select()
            .single()

        if (insertError) {
            return NextResponse.json({ error: insertError.message }, { status: 500 })
        }

        // 6. Return response (In real life, we would also trigger a resend/sendgrid email here)
        // For MVP, we'll return the rawToken to the client so it can be copied directly
        // since sending actual emails requires an external SMTP provider hookup.
        return NextResponse.json({
            success: true,
            invite: insertedInvite,
            rawToken: rawToken, // FOR MVP: To simulate the "email link"
            inviteLink: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/workspaces/invite/accept?token=${rawToken}`
        })

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
