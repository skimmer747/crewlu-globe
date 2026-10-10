import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://corxvurxpnrzekbxdgye.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_1wBeBjIIvEmMygoM9vWA2A_ptocrFGM'

/** Where supabase-js keeps the session in localStorage (its default name), set explicitly so sign-out can always clear it. */
export const AUTH_STORAGE_KEY = 'sb-corxvurxpnrzekbxdgye-auth-token'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY },
})
