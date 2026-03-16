import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')

    if (!code) {
        return NextResponse.json({ error: "Missing code", url: request.url })
    }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    return NextResponse.json({
        success: !error,
        error: error?.message,
        data: data ? "Session retrieved successfully" : null,
        url: request.url,
        origin
    })
}
