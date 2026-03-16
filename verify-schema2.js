require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function test() {
    const { data, error } = await supabase.from('datasets').select('id, name, market, concept').limit(1);
    console.log("Data:", data);
    console.log("Error:", error);
}
test();
