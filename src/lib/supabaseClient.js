/**
 * Supabase Client Configuration
 * 
 * Reads credentials from environment variables (VITE_ prefix for Vite).
 * Exports a singleton client instance used throughout the app.
 * Gracefully handles missing credentials so the UI still renders.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isMissing =
  !supabaseUrl ||
  !supabaseAnonKey ||
  supabaseUrl.startsWith('your-') ||
  supabaseAnonKey.startsWith('your-');

if (isMissing) {
  console.warn(
    '⚠️  Supabase credentials missing or still set to placeholders.\n' +
    '   Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local\n' +
    '   The app will render with an empty dataset until configured.'
  );
}

// Use a valid dummy URL when credentials are missing so createClient
// doesn't throw and the rest of the app can still mount.
export const supabase = isMissing
  ? null
  : createClient(supabaseUrl, supabaseAnonKey);

/** Whether a valid Supabase connection is configured */
export const isSupabaseConfigured = !isMissing;
