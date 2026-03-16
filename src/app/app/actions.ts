'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createWorkspace(formData: FormData) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { success: false, message: 'Unauthorized' }
    }

    const name = formData.get('name') as string
    if (!name) {
        return { success: false, message: 'Workspace name is required' }
    }

    const { data: workspace, error } = await supabase
        .from('workspaces')
        .insert([{ name, owner_id: user.id }])
        .select()
        .single()

    if (error) {
        return { success: false, message: error.message }
    }

    revalidatePath('/app')
    return { success: true, workspace }
}
