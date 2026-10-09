type LocalDevelopmentEnvironment = { mode?: string; flag?: string; api?: string };

// Never relax production CAPTCHA requirements. The local launcher supplies all
// three values explicitly and uses the widget's existing quiet development token.
export function isLocalDevelopmentEnvironment(environment: LocalDevelopmentEnvironment = {
  mode: process.env.NODE_ENV,
  flag: process.env.NEXT_PUBLIC_LOCAL_DEVELOPMENT,
  api: process.env.NEXT_PUBLIC_SUPABASE_URL,
}) {
  return environment.mode === "development"
    && environment.flag === "true"
    && environment.api === "http://127.0.0.1:54341";
}
