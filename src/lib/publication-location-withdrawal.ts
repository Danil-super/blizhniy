import type { PostgresQueries } from "./postgres";
import type { PublicationTextField } from "./publication-text-selection";

type Alias = "l" | "w" | "s";
const textFields={
 l:['title','description'],
 w:['title','description','organization','schedule','workFormat','requirements','responsibilities','conditions'],
 s:['title','description','skills','experience'],
} as const;
export type PublicText = Partial<Record<PublicationTextField,string|null>>;
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
  return `,exists(${withdrawal(alias, "'location'")}) as "locationWithdrawn"`;
}

function withdrawal(alias: "l" | "w" | "s", scope: string) {
  const kind = alias === "l" ? "'listing'" : `${alias}.kind`;
  return `select 1 from app_publication_privacy.location_withdrawals privacy
    where privacy.kind=${kind} and privacy.publication_id=${alias}.id and privacy.scope=${scope}`;
}

function originalText(alias:Alias,field:PublicationTextField) {
 return alias==='l'?`l.${field}`:`${alias}.form->>'${field}'`;
}

function withdrawnText(alias:Alias,field:PublicationTextField,original:string) {
 const kind=alias==='l'?"'listing'":`${alias}.kind`;
 return `app_publication_privacy.public_text(${kind},${alias}.id,'${field}',${original})`;
}

export function publicTextSql(alias:Alias,field:PublicationTextField,enabled?:boolean) {
 const original=originalText(alias,field);
 return enabled?`coalesce(${withdrawnText(alias,field,original)},${original})`:original;
}

export function publicTextColumn(alias:Alias,enabled?:boolean) {
 if(!enabled)return '';
 const fields=textFields[alias].map(field=>`'${field}',${withdrawnText(alias,field,originalText(alias,field))}`);
 return `,json_build_object(${fields.join(',')}) as "publicText"`;
}

export function publicationWithdrawalEligibility(alias: "l" | "w" | "s", enabled?: boolean): string {
  if (process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "suppress") return " and false";
  return enabled ? ` and not exists(${withdrawal(alias, "'publication'")})` : "";
}

export function publicPhotoEligibility(alias: "l" | "w" | "s", photo: "p.media_id" | "image.id", enabled?: boolean): string {
  return enabled ? ` and not exists(${withdrawal(alias, "'photo:'||" + photo + "::text")})` : "";
}

export function withdrawnPhotoColumn(alias: "w" | "s", enabled?: boolean): string {
  if (!enabled) return "";
  const table = alias === "w" ? "app.work_publication_photos" : "app.service_publication_photos";
  return `,array(select p.media_id::text from ${table} p where p.publication_id=${alias}.id
    and exists(${withdrawal(alias, "'photo:'||p.media_id::text")})) as "withdrawnPhotos"`;
}

export function publicAvatarSql(enabled?: boolean): string {
  const avatar = "coalesce(profile->>'avatarDataUrl','')";
  return enabled ? `case when exists(${withdrawal('s', "'avatar'")}) then '' else ${avatar} end` : avatar;
}

export async function isPublicationWithdrawn(db: PostgresQueries, kind: string, id: string): Promise<boolean> {
  if (process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "suppress") return true;
  if (!await hasLocationWithdrawalSchema(db)) return false;
  const result = await db.query("select 1 from app_publication_privacy.location_withdrawals where kind=$1 and publication_id=$2 and scope='publication'", [kind, id]);
  return result.rows.length > 0;
}
