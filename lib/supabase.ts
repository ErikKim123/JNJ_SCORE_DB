// Server-side Supabase client. ALWAYS uses service_role key — RLS is OFF in MVP.
// Never import this from a Client Component or expose to the browser.
//
// When RLS is re-enabled (Phase 2 — Supabase Auth), split into two clients:
//   getServerClient()   — service_role, for admin actions
//   getRequestClient(jwt) — anon + user JWT, for per-user reads

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (!URL || !SERVICE_KEY) {
    throw new Error(
      'Supabase env not configured. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  if (!_client) {
    _client = createClient(URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
