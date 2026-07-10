type SupabaseRestMethod = "GET" | "POST" | "PATCH" | "DELETE";

type SupabaseRestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  attempts?: number;
  method?: SupabaseRestMethod;
  prefer?: string;
  timeoutMs?: number;
  useServiceRole?: boolean;
};

export function getSupabaseRestConfig(useServiceRole = true) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = useServiceRole ? serviceRoleKey : anonKey;

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

  const maxAttempts = options.attempts ?? 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = options.timeoutMs ? new AbortController() : undefined;
    const timeout = controller ? globalThis.setTimeout(() => controller.abort(), options.timeoutMs) : undefined;

    try {
      response = await fetch(buildSupabaseRestUrl(path), {
        method: options.method ?? "GET",
        signal: controller?.signal,
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

      if (response.status < 500 || attempt === maxAttempts) {
        break;
      }
    } catch (error) {
      fetchError = error;

      if (attempt === maxAttempts) {
        throw error;
      }
    } finally {
      if (timeout) {
        globalThis.clearTimeout(timeout);
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
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
