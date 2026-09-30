import { getSupabaseRestConfig, supabaseRest } from "@/lib/supabase-rest";

type UserRoleRow = {
  role: string;
};

type SupabaseAuthUser = {
  email?: string;
  id: string;
};

type ProfileAccessRow = {
  is_blocked?: boolean | null;
};

// Authentication and authorization are a fail-closed boundary. Keep the
// database calls short and do not retry them: a delayed permission check must
// not tie up an application request or accidentally grant access.
const serverAuthTimeoutMs = 3000;
const serverAuthAttempts = 1;

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

async function userCanAccessApi(userId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return process.env.NODE_ENV !== "production";
  }

  try {
    const data = await supabaseRest<ProfileAccessRow[]>(
      `/rest/v1/profiles?select=is_blocked&id=eq.${encodeURIComponent(userId)}&limit=1`,
      { attempts: serverAuthAttempts, timeoutMs: serverAuthTimeoutMs },
    );
    const profile: ProfileAccessRow | undefined = data?.[0];

    return profile !== undefined && profile.is_blocked !== true;
  } catch {
    return false;
  }
}

// A verified Supabase session is enough for data-subject requests, including
// requests from an account whose access to the rest of the site is blocked.
export async function getVerifiedRequestUser(request: Request) {
  const token = getBearerToken(request);
  const { supabaseAnonKey, supabaseUrl } = getSupabaseServerConfig();

  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  try {
    const user = await supabaseRest<SupabaseAuthUser>("/auth/v1/user", {
      attempts: serverAuthAttempts,
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: serverAuthTimeoutMs,
      useServiceRole: false,
    });

    if (!user?.id) {
      return null;
    }

    return { user };
  } catch {
    return null;
  }
}

export async function getAuthenticatedRequestUser(request: Request) {
  const auth = await getVerifiedRequestUser(request);

  if (!auth || !(await userCanAccessApi(auth.user.id))) {
    return null;
  }

  return auth;
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

  try {
    const data = await supabaseRest<UserRoleRow[]>(
      `/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(auth.user.id)}`,
      { attempts: serverAuthAttempts, timeoutMs: serverAuthTimeoutMs },
    );

    return data.some((item) => item.role === "admin");
  } catch {
    return false;
  }
}

export function isDemoAdminBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_DEMO_ADMIN_BYPASS === "true";
}
