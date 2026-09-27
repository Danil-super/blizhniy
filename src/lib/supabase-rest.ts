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

const DEFAULT_READ_TIMEOUT_MS = 8000;
const DEFAULT_WRITE_TIMEOUT_MS = 20000;

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

  const method = options.method ?? "GET";
  // A write can have committed even if its response is lost. Do not automatically
  // repeat non-idempotent requests; callers may opt in when they have an idempotency key.
  const maxAttempts = options.attempts ?? (method === "GET" ? 3 : 1);
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0
    ? options.timeoutMs
    : method === "GET" ? DEFAULT_READ_TIMEOUT_MS : DEFAULT_WRITE_TIMEOUT_MS;
  let response: Response | undefined;
  let payload: T | null = null;
  let fetchError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(buildSupabaseRestUrl(path), {
        method,
        signal: controller.signal,
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
      const text = await response.text();
      payload = text ? (JSON.parse(text) as T) : null;

      if (response.status < 500 || attempt === maxAttempts) {
        break;
      }
    } catch (error) {
      fetchError = error;

      if (attempt === maxAttempts) {
        throw error;
      }
    } finally {
      globalThis.clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }

  if (!response) {
    throw fetchError instanceof Error ? fetchError : new Error("Supabase request failed");
  }

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
