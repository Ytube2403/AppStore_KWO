import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
// To test RLS, we MUST use the anon key and authenticate! 
// If we use service_role, RLS is bypassed.
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function runTest() {
    console.log('--- Testing Auth and Workspace Creation ---')

    // 1. Sign up a test user
    const email = `test_${Date.now()}@example.com`
    const password = 'Testpassword123!'

    console.log(`1. Signing up user: ${email}`)
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password
    })

    if (authError) {
        console.error('Sign up failed:', authError.message)
        return
    }

    const user = authData.user
    if (!user) {
        console.error('Sign up succeeded but no user returned.')
        return
    }
    console.log(`User created. ID: ${user.id}`)

    // 2. Try to create workspace
    console.log('2. Attempting to create workspace...')
    const { data: wsData, error: wsError } = await supabase
        .from('workspaces')
        .insert([{ name: 'Test Workspace', owner_id: user.id }])
        .select()

    if (wsError) {
        console.error('Workspace creation failed with RLS/DB Error:', wsError.message, wsError.details, wsError.hint)
    } else {
        console.log('Workspace created successfully:', wsData)
    }

    // Cleanup with service role if needed, or leave it.
    console.log('--- Test Complete ---')
}

runTest()
