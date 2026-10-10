import { readLocalAuthConfig } from "./auth-http";
import { createPostgresDatabase } from "./postgres";
import type { PostgresDatabase } from "./postgres";

const processState = globalThis as typeof globalThis & { blizhniyLocalDatabase?: PostgresDatabase };

/** Single lazy pool for local account/resource handlers. Restart after config changes. */
export function getLocalDatabase(): PostgresDatabase {
  if (typeof window !== "undefined" || !readLocalAuthConfig()) throw new Error("Local database unavailable");
  return processState.blizhniyLocalDatabase ??= createPostgresDatabase();
}
