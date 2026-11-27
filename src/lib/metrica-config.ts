import { getPublicRuntimeSetting } from "./public-runtime-config";

/** Counter IDs are public positive integers, never script text or arbitrary URLs. */
export function parseMetricaCounterId(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (id.length > 16 || !/^[1-9]\d*$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Server: current runtime env. Browser: response meta only, without a build-time fallback. */
export function getMetricaCounterId(): number | null {
  return parseMetricaCounterId(getPublicRuntimeSetting("metrica-id"));
}

export type MetricaTransport = "sdk" | "measurement-protocol";

export function getMetricaTransport(env: NodeJS.ProcessEnv = process.env): MetricaTransport | null {
  const mode = env.BLIZHNIY_YANDEX_METRICA_MODE;
  const token = env.BLIZHNIY_YANDEX_METRICA_MEASUREMENT_TOKEN;
  if (mode === undefined && token === undefined) return "sdk";
  if (mode === "measurement-protocol" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(token ?? "")) {
    return "measurement-protocol";
  }
  return null;
}
