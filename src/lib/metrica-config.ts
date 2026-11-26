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
