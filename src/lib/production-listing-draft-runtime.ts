import { randomUUID } from "node:crypto";
import { authJson } from "./auth-http";
import { readProductionAuthConfig } from "./production-auth-config";
import { getProductionAccountDatabase } from "./production-auth-runtime";
import { createProductionListingDraftHandler } from "./production-listing-draft-http";
import { PostgresListingDraftStore } from "./postgres-listing-drafts";

export async function handleProductionListingDraftRequest(request: Request): Promise<Response> {
  try {
    const config = readProductionAuthConfig();
    if (!config) return authJson({ error: { code: "NOT_FOUND" } }, 404);
    return await createProductionListingDraftHandler(config, async () => {
      const { db, limiter } = await getProductionAccountDatabase(config);
      // Resource schema/grants must already exist; HTTP never provisions permissions or falls back.
      await db.query("select id,author_id,listing_type,category_id,city_id,title,description,price,revision,status from app.listings limit 0");
      return { store: new PostgresListingDraftStore(db), limiter };
    })(request);
  } catch {
    const requestId = randomUUID();
    console.warn(JSON.stringify({ event: "listing_draft_configuration_failed", requestId, code: "DRAFT_UNAVAILABLE" }));
    return authJson({ error: { code: "DRAFT_UNAVAILABLE" } }, 503, { "X-Request-ID": requestId });
  }
}
