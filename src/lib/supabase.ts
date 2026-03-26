import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Default client for browser or anon operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for backend operations (e.g., executing raw SQL, inserting server-side)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
