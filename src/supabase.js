import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && key)
export const supabase = isSupabaseConfigured ? createClient(url, key) : null
export const STORAGE_BUCKET = 'manhwa'

export function getPublicUrl(path) {
  if (!supabase) return ''
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
