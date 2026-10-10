import { createHmac, randomUUID } from "node:crypto";
import { AuthRateLimiter, AuthRequestError, authJson, readAuthJson, readLocalAuthConfig } from "./auth-http";
import type { LocalAuthConfig } from "./auth-http";
import { readAccountSessionToken } from "./account-cookie";
import { getLocalDatabase } from "./local-database";
import { AdminAccessError } from "./admin-authorization";
import { CatalogAdministration, CategoryEditInputError } from "./catalog-administration";
import { TariffAdministration, TariffEditInputError } from "./tariff-administration";

type Runtime = { catalog: CatalogAdministration; tariffs: TariffAdministration; limiter: AuthRateLimiter };
const processState = globalThis as typeof globalThis & { blizhniyLocalAdminRuntime?: Runtime };
const resources = new Set(["categories", "category-order", "tariffs"]);

function runtime(config: LocalAuthConfig): Runtime {
  if (!processState.blizhniyLocalAdminRuntime) {
    const db = getLocalDatabase();
    // Separate persistent key namespace: admin traffic cannot consume login attempts.
    const secret = createHmac("sha256", config.rateSecret).update("local-admin").digest("hex");
    processState.blizhniyLocalAdminRuntime = { catalog: new CatalogAdministration(db), tariffs: new TariffAdministration(db), limiter: new AuthRateLimiter(db, secret) };
  }
  return processState.blizhniyLocalAdminRuntime;
}

/** Default off, loopback development/test HTTPS only. No legacy auth or demo bypass. */
export async function handleLocalAdminRequest(request: Request, resource: string): Promise<Response> {
  const requestId = randomUUID();
  const start = Date.now();
  let status = 503;
  let code: string | undefined;
  let operation = "unknown";
  const respond = (body: unknown, nextStatus: number, headers?: Record<string, string>) => {
    status = nextStatus;
    return authJson(body, status, { "X-Request-ID": requestId, ...headers });
  };
  try {
    const config = readLocalAuthConfig();
    if (!config || !resources.has(resource)) throw new AuthRequestError(404, "NOT_FOUND");
    if (!config.origin.startsWith("https://")) throw new AuthRequestError(503, "HTTPS_REQUIRED");
    if (!((request.method === "POST" && resource !== "category-order") || request.method === "PATCH")) {
      throw new AuthRequestError(405, "METHOD_NOT_ALLOWED");
    }
    operation = `${resource}:${resource === "category-order" ? "reorder" : request.method === "POST" ? "list" : "edit"}`;
    const input = await readAuthJson(request, config, 2000, request.method as "POST" | "PATCH");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AuthRequestError(422, "INVALID_INPUT");
    const row = input as Record<string, unknown>;
    if ((request.method === "POST" && Object.keys(row).length !== 0) ||
        (resource === "category-order" && (Object.keys(row).length !== 1 || !Object.hasOwn(row, "ids")))) throw new AuthRequestError(422, "INVALID_INPUT");
    const token = readAccountSessionToken(request);
    if (!token) throw new AuthRequestError(401, "UNAUTHENTICATED");
    const state = runtime(config);
    if (!await state.limiter.allow()) throw new AuthRequestError(429, "RATE_LIMITED");
    if (request.method === "POST") {
      return resource === "categories" ? respond({ categories: await state.catalog.listCategoryRows(token) }, 200)
        : respond({ tariffs: await state.tariffs.listTariffs(token) }, 200);
    }
    if (resource === "category-order") {
      await state.catalog.reorderCategories(token, row.ids);
      return respond({ status: "saved" }, 200);
    }
    if (resource === "categories") {
      const category = await state.catalog.updateCategory(token, row);
      if (!category) throw new AuthRequestError(404, "NOT_FOUND");
      return respond({ category }, 200);
    }
    if (!await state.tariffs.updateTariff(token, row)) throw new AuthRequestError(404, "NOT_FOUND");
    return respond({ status: "saved" }, 200);
  } catch (error) {
    if (error instanceof AuthRequestError) {
      code = error.code;
      return respond({ error: { code } }, error.status, code === "RATE_LIMITED" ? { "Retry-After": "900" }
        : code === "METHOD_NOT_ALLOWED" ? { Allow: resource === "category-order" ? "PATCH" : "POST, PATCH" } : undefined);
    }
    if (error instanceof AdminAccessError) { code = "ADMIN_REQUIRED"; return respond({ error: { code } }, 403); }
    if (error instanceof CategoryEditInputError || error instanceof TariffEditInputError) {
      code = "INVALID_INPUT"; return respond({ error: { code } }, 422);
    }
    code = "ADMIN_UNAVAILABLE";
    return respond({ error: { code } }, 503);
  } finally {
    console.info(JSON.stringify({ event: "local_admin_request", entryPoint: "http", requestId, operation, status, code, durationMs: Date.now()-start }));
  }
}
