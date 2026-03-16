import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    const { data } = await supabase.from('keywords').select('id, keyword, is_qualified').limit(500)
    console.log("Total Fetched:", data?.length)
    if (data) {
        const falseCount = data.filter(r => r.is_qualified === false).length
        const trueCount = data.filter(r => r.is_qualified === true).length
        const nullCount = data.filter(r => r.is_qualified === null).length
        console.log(`True: ${trueCount} | False: ${falseCount} | Null: ${nullCount}`)
    }
}
run()
