import "server-only";
import { readProductionAuthConfig } from "./production-auth-config";
import { getProductionAccountDatabase } from "./production-auth-runtime";
import { PostgresCatalogRepository } from "./postgres-catalog";
import { PostgresTariffRepository } from "./postgres-tariffs";

/** Public projections reuse the verified limited Auth pool, never a second owner/legacy connection. */
export async function getProductionReferenceRepositories() {
  if (typeof window !== "undefined") throw new Error("References are server-only");
  const config = readProductionAuthConfig();
  if (!config) return null;
  const { db } = await getProductionAccountDatabase(config);
  return { catalog: new PostgresCatalogRepository(db), tariffs: new PostgresTariffRepository(db) };
}
