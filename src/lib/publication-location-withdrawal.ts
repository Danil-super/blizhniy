import type { PostgresQueries } from "./postgres";

// Remember only presence. An installed boundary with broken permissions must fail closed.
const installed = new WeakSet<PostgresQueries>();
export async function hasLocationWithdrawalSchema(db: PostgresQueries): Promise<boolean> {
  if (installed.has(db)) return true;
  const { rows: [row] } = await db.query<{ installed: boolean }>(
    "select pg_catalog.to_regnamespace('app_publication_privacy') is not null as installed", [], "bounded-read",
  );
  if (typeof row?.installed !== "boolean") throw new Error("Publication privacy capability unavailable");
  if (!row.installed && process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "required") {
    throw new Error("Required location withdrawal schema unavailable");
  }
  if (row.installed) installed.add(db);
  return row.installed;
}

export function locationWithdrawalColumn(alias: "l" | "w" | "s", enabled?: boolean): string {
  if (process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "suppress") return ',true as "locationWithdrawn"';
  if (!enabled) return "";
  return `,exists(${withdrawal(alias, 'location')}) as "locationWithdrawn"`;
}

function withdrawal(alias: "l" | "w" | "s", scope: "location" | "publication") {
  const kind = alias === "l" ? "'listing'" : `${alias}.kind`;
  return `select 1 from app_publication_privacy.location_withdrawals privacy
    where privacy.kind=${kind} and privacy.publication_id=${alias}.id and privacy.scope='${scope}'`;
}

export function publicationWithdrawalEligibility(alias: "l" | "w" | "s", enabled?: boolean): string {
  if (process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "suppress") return " and false";
  return enabled ? ` and not exists(${withdrawal(alias, 'publication')})` : "";
}

export async function isPublicationWithdrawn(db: PostgresQueries, kind: string, id: string): Promise<boolean> {
  if (process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "suppress") return true;
  if (!await hasLocationWithdrawalSchema(db)) return false;
  const result = await db.query("select 1 from app_publication_privacy.location_withdrawals where kind=$1 and publication_id=$2 and scope='publication'", [kind, id]);
  return result.rows.length > 0;
}
