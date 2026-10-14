"use client";

import { createClient } from "@supabase/supabase-js";
import { getPublicRuntimeSetting } from "@/lib/public-runtime-config";

let browserClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseBrowserConfig() {
  if (typeof document !== "undefined" && document.querySelector('meta[name="blizhniy-auth-backend"]')?.getAttribute("content") !== "legacy") {
    return { supabaseAnonKey: undefined, supabaseUrl: undefined };
  }
  const supabaseUrl = getPublicRuntimeSetting("legacy-url");
  const supabaseAnonKey = getPublicRuntimeSetting("legacy-anon-key");

  return { supabaseAnonKey, supabaseUrl };
}

export function isSupabaseBrowserConfigured() {
  const { supabaseAnonKey, supabaseUrl } = getSupabaseBrowserConfig();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabaseBrowserClient() {
  const { supabaseAnonKey, supabaseUrl } = getSupabaseBrowserConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase env is not configured");
  }

  browserClient ??= createClient(supabaseUrl, supabaseAnonKey);
  return browserClient;
}
