'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'

export async function login(formData: FormData) {
    const supabase = await createClient()

    // type-casting here for convenience
    // in practice, you should validate your inputs
    const data = {
        email: formData.get('email') as string,
        password: formData.get('password') as string,
    }

    const { error } = await supabase.auth.signInWithPassword(data)

    if (error) {
        return { success: false, message: error.message }
    }

    revalidatePath('/app')
    redirect('/app')
}

export async function signup(formData: FormData) {
    const supabase = await createClient()

    // type-casting here for convenience
    // in practice, you should validate your inputs
    const data = {
        email: formData.get('email') as string,
        password: formData.get('password') as string,
    }

    const { error } = await supabase.auth.signUp(data)

    if (error) {
        return { success: false, message: error.message }
    }

    revalidatePath('/app')
    redirect('/app')
}

export async function loginWithGoogle() {
    const supabase = await createClient()

    // Retrieve headers to construct the callback URL dynamically
    const headersList = await headers()
    const host = headersList.get('host')
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https'

    // Resolve siteUrl gracefully
    let siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) {
        siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
            ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
            : `${protocol}://${host}`;
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${siteUrl}/auth/callback`,
        },
    })

    if (error) {
        console.error("Google Auth Error:", error.message)
    }

    if (data.url) {
        redirect(data.url)
    }
}
