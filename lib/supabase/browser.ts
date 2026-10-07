import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

let client: SupabaseClient | undefined;

export function createClient() {
  if (client) return client;
  const { url, anonKey } = getSupabaseEnv();
  client = createBrowserClient(url, anonKey);
  return client;
}