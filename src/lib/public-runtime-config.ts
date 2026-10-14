// Public compatibility settings only. Never pass an environment object to the client.
// Dynamic lookup avoids Next's build-time NEXT_PUBLIC_* inlining.
const publicSettings = {
  "legacy-url": "NEXT_PUBLIC_SUPABASE_URL",
  "legacy-anon-key": "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "dgis-key": "NEXT_PUBLIC_2GIS_API_KEY",
} as const;

export function getPublicRuntimeSetting(setting: keyof typeof publicSettings): string | undefined {
  if (!Object.hasOwn(publicSettings, setting)) return undefined;
  if (typeof document !== "undefined") {
    return document.querySelector(`meta[name="blizhniy-${setting}"]`)?.getAttribute("content")?.trim() || undefined;
  }
  return process.env[publicSettings[setting]]?.trim() || undefined;
}
