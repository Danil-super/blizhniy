import { buildSupabaseRestUrl, getSupabaseRestConfig } from "@/lib/supabase-rest";

type UserRoleRow = {
  role: string;
};

type SupabaseAuthUser = {
  email?: string;
  id: string;
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

  let response: Response | undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(buildSupabaseRestUrl("/auth/v1/user"), {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (response.status < 500 || attempt === 3) {
        break;
      }
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }

  if (!response?.ok) {
    return null;
  }

  const user = (await response.json().catch(() => null)) as SupabaseAuthUser | null;

  if (!user?.id) {
    return null;
  }

  return { user };
}

export async function isAuthenticatedRequest(request: Request) {
  return Boolean(await getAuthenticatedRequestUser(request));
}

export async function isAdminRequest(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return false;
  }

  const { key } = getSupabaseRestConfig();

  if (!key) {
    return false;
  }

  const response = await fetch(buildSupabaseRestUrl(`/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(auth.user.id)}`), {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return false;
  }

  const data = (await response.json().catch(() => null)) as UserRoleRow[] | null;

  return data?.some((item) => item.role === "admin") ?? false;
}

export function isDemoAdminBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_DEMO_ADMIN_BYPASS === "true";
}
