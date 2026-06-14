type SupabaseRestMethod = "GET" | "POST" | "PATCH" | "DELETE";

type SupabaseRestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  method?: SupabaseRestMethod;
  prefer?: string;
  useServiceRole?: boolean;
};

export function getSupabaseRestConfig(useServiceRole = true) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = useServiceRole ? serviceRoleKey || anonKey : anonKey;

  return { key, supabaseUrl };
}

export function isSupabaseRestConfigured(useServiceRole = true) {
  const { key, supabaseUrl } = getSupabaseRestConfig(useServiceRole);
  return Boolean(key && supabaseUrl);
}

export function isSupabaseServiceRoleConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function buildSupabaseRestUrl(path: string) {
  const { supabaseUrl } = getSupabaseRestConfig();

  if (!supabaseUrl) {
    throw new Error("Supabase URL is not configured");
  }

  return `${supabaseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function supabaseRest<T>(path: string, options: SupabaseRestOptions = {}) {
  const { key, supabaseUrl } = getSupabaseRestConfig(options.useServiceRole ?? true);

  if (!supabaseUrl || !key) {
    throw new Error("Supabase env is not configured");
  }

  let response: Response | undefined;
  let fetchError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(buildSupabaseRestUrl(path), {
        method: options.method ?? "GET",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.prefer ? { Prefer: options.prefer } : {}),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
      });

      if (response.status < 500 || attempt === 3) {
        break;
      }
    } catch (error) {
      fetchError = error;

      if (attempt === 3) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }

  if (!response) {
    throw fetchError instanceof Error ? fetchError : new Error("Supabase request failed");
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `Supabase request failed with ${response.status}`;

    throw new Error(message);
  }

  return payload as T;
}

export function isUuid(value?: string) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value));
}
