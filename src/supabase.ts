import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://corxvurxpnrzekbxdgye.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_1wBeBjIIvEmMygoM9vWA2A_ptocrFGM'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
})
