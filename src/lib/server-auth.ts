import { createClient } from "@supabase/supabase-js";

type UserRoleRow = {
  role: string;
};

function getSupabaseServerConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return { supabaseAnonKey, supabaseUrl };
}

export function isSupabaseServerConfigured() {
  const { supabaseAnonKey, supabaseUrl } = getSupabaseServerConfig();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function getBearerToken(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
}

export async function getAuthenticatedRequestUser(request: Request) {
  const token = getBearerToken(request);
  const { supabaseAnonKey, supabaseUrl } = getSupabaseServerConfig();

  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return { supabase, user: data.user };
}

export async function isAuthenticatedRequest(request: Request) {
  return Boolean(await getAuthenticatedRequestUser(request));
}

export async function isAdminRequest(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return false;
  }

  const { data, error } = await auth.supabase.from("user_roles").select("role").eq("user_id", auth.user.id);

  if (error) {
    return false;
  }

  return (data as UserRoleRow[] | null)?.some((item) => item.role === "admin") ?? false;
}

export function isDemoAdminBypassEnabled() {
  return process.env.ENABLE_DEMO_ADMIN_BYPASS === "true";
}
