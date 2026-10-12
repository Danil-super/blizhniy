import { randomUUID } from "node:crypto";
import { authJson } from "./auth-http";
import { readProductionAuthConfig } from "./production-auth-config";
import { getProductionAccountDatabase } from "./production-auth-runtime";
import { createProductionProfileHandler } from "./production-profile-http";
import { PostgresProfileStore } from "./postgres-profile";

export async function handleProductionProfileRequest(request: Request): Promise<Response> {
  try {
    const config = readProductionAuthConfig();
    if (!config) return authJson({ error: { code: "NOT_FOUND" } }, 404);
    return await createProductionProfileHandler(config, async () => {
      const { db, limiter } = await getProductionAccountDatabase(config);
      // Missing schema/grants fail closed on the resource path, without touching legacy storage.
      await db.query("select user_id,profile,updated_at from app.cabinet_profiles limit 0");
      return { store: new PostgresProfileStore(db), limiter };
    })(request);
  } catch {
    const requestId = randomUUID();
    console.warn(JSON.stringify({ event: "profile_configuration_failed", requestId, code: "PROFILE_UNAVAILABLE" }));
    return authJson({ error: { code: "PROFILE_UNAVAILABLE" } }, 503, { "X-Request-ID": requestId });
  }
}
