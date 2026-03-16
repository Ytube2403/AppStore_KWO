import { NextResponse } from 'next/server'
// The client you created from the Server-Side Auth instructions
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    // if "next" is in param, use it as the redirect URL
    const next = searchParams.get('next') ?? '/app'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error) {
            const forwardedHost = request.headers.get('x-forwarded-host') // original origin before load balancer
            const isLocalEnv = process.env.NODE_ENV === 'development'

            let baseUrl = origin;
            if (!isLocalEnv) {
                if (process.env.NEXT_PUBLIC_SITE_URL) {
                    baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
                } else if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
                    baseUrl = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
                } else if (forwardedHost) {
                    baseUrl = `https://${forwardedHost}`;
                }
            }

            return NextResponse.redirect(`${baseUrl}${next}`)
        } else {
            console.error("Auth callback exchange error:", error);
        }
    } else {
        console.error("No code provided in auth callback");
    }

    // return the user to an error page with instructions or simply back to login
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
