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

export function locationConsentRequired(): boolean {
  return process.env.BLIZHNIY_PUBLICATION_LOCATION_CONSENT === "required";
}

export function contactConsentRequired(): boolean {
  return process.env.BLIZHNIY_PUBLICATION_CONTACT_CONSENT === "required";
}

export function profileConsentRequired(): boolean {
  return process.env.BLIZHNIY_PUBLICATION_PROFILE_CONSENT === "required";
}

function publicProfileValueSql(alias:"l"|"s",category:"name"|"avatar",value:string,fallback:string,enabled?:boolean):string {
  const required=profileConsentRequired();
  if(!enabled)return required?fallback:value;
  const kind=alias==='l'?"'listing'":'s.kind';
  const facts=category==='avatar'?`app_publication_privacy.avatar_facts(${value})`:`to_jsonb(${value})`;
  const missing=required?` or not app_publication_privacy.publication_is_consented(${kind},${alias}.id,${alias}.author_id,'${category}',${facts})`:'';
  return `case when exists(${withdrawal(alias, `'${category}'`)})${missing} then ${fallback} else ${value} end`;
}

export function publicProfileNameSql(alias:"l"|"s",enabled?:boolean):string {
  return publicProfileValueSql(alias,'name',"profile.profile->>'name'",'null',enabled);
}

export function listingContactVisibility(enabled?: boolean): string {
  const consent = contactConsentRequired();
  if (!enabled) return consent ? ',true as "phoneHidden",true as "messengerHidden"' : "";
  return ([["phone", "contact_phone"], ["messenger", "messenger_url"]] as const).map(([category, column]) => {
    const withdrawn = `exists(${withdrawal("l", `'${category}'`)})`;
    const allowed = consent
      ? ` or not app_publication_privacy.publication_is_consented('listing',l.id,l.author_id,'${category}',to_jsonb(l.${column}))`
      : "";
    return `,(${withdrawn}${allowed}) as "${category}Hidden"`;
  }).join("");
}

export function linkConsentRequired(): boolean {
  return process.env.BLIZHNIY_PUBLICATION_LINK_CONSENT === "required";
}

export function publicLinkColumn(alias:"w"|"s",enabled?:boolean):string {
  const required=linkConsentRequired();
  if(!enabled)return required?',true as "linkHidden"':"";
  const value=alias==='w'?"w.form->>'website'":"s.form->>case s.kind when 'marquee' then 'href' else 'videoUrl' end";
  const missing=required
    ?` or not app_publication_privacy.publication_is_consented(${alias}.kind,${alias}.id,${alias}.author_id,'link',to_jsonb(${value}))`
    :"";
  return `,(exists(${withdrawal(alias,"'link'")})${missing}) as "linkHidden"`;
}

export function locationWithdrawalColumn(alias: Alias, enabled?: boolean): string {
  const consent = locationConsentRequired();
  if (process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "suppress" || consent && !enabled) {
    return ',true as "locationWithdrawn"';
  }
  if (!enabled) return "";
  const withdrawn = `exists(${withdrawal(alias, "'location'")})`;
  if (!consent) return `,${withdrawn} as "locationWithdrawn"`;
  const kind = alias === "l" ? "'listing'" : `${alias}.kind`;
  const args = alias === "l"
    ? "city.name,l.address,to_jsonb(l.latitude::float8),to_jsonb(l.longitude::float8),l.show_exact_address"
    : `${alias}.form->>'cityName',${alias}.form->>'address',${alias}.form->'latitude',${alias}.form->'longitude',${alias}.form->'showExactAddress'='true'::jsonb`;
  return `,(${withdrawn} or not app_publication_privacy.location_is_consented(${kind},${alias}.id,${alias}.author_id,
    app_publication_privacy.location_facts(${args}))) as "locationWithdrawn"`;
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

export function textConsentRequired(): boolean {
 return process.env.BLIZHNIY_PUBLICATION_TEXT_CONSENT === "required";
}

function consentedText(alias:Alias,field:PublicationTextField,original:string,projection:string,enabled?:boolean) {
 if(!textConsentRequired())return projection;
 if(!enabled)return "''";
 const kind=alias==='l'?"'listing'":`${alias}.kind`;
 return `case when app_publication_privacy.text_is_consented(${kind},${alias}.id,${alias}.author_id,'${field}',${original})
  then ${projection} else '' end`;
}

export function publicTextSql(alias:Alias,field:PublicationTextField,enabled?:boolean) {
 const original=originalText(alias,field);
 const projection=enabled?`coalesce(${withdrawnText(alias,field,original)},${original})`:original;
 return consentedText(alias,field,original,projection,enabled);
}

export function publicTextColumn(alias:Alias,enabled?:boolean) {
 if(!enabled&&!textConsentRequired())return '';
 const fields=textFields[alias].map(field=>{
  const original=originalText(alias,field);
  return `'${field}',${consentedText(alias,field,original,withdrawnText(alias,field,original),enabled)}`;
 });
 return `,json_build_object(${fields.join(',')}) as "publicText"`;
}

export function publicationWithdrawalEligibility(alias: "l" | "w" | "s", enabled?: boolean): string {
  if (process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "suppress") return " and false";
  return enabled ? ` and not exists(${withdrawal(alias, "'publication'")})` : "";
}

export function photoConsentRequired(): boolean {
  return process.env.BLIZHNIY_PUBLICATION_PHOTO_CONSENT === "required";
}

export function publicPhotoEligibility(alias: Alias, photo: "p.media_id" | "image.id", enabled?: boolean): string {
  const required=photoConsentRequired();
  if(!enabled)return required?" and false":"";
  const category="'photo:'||"+photo+"::text";
  const visible=` and not exists(${withdrawal(alias,category)})`;
  if(!required)return visible;
  const kind=alias==='l'?"'listing'":`${alias}.kind`;
  return visible+` and app_publication_privacy.publication_is_consented(${kind},${alias}.id,${alias}.author_id,${category},
    (select to_jsonb(media.sha256) from app.media_objects media
     where media.id=${photo} and media.owner_id=${alias}.author_id and media.state='ready'))`;
}

export function withdrawnPhotoColumn(alias: "w" | "s", enabled?: boolean): string {
  const visible=publicPhotoEligibility(alias,"p.media_id",enabled);
  if (!visible) return "";
  const table = alias === "w" ? "app.work_publication_photos" : "app.service_publication_photos";
  return `,array(select p.media_id::text from ${table} p where p.publication_id=${alias}.id
    and not (true${visible})) as "withdrawnPhotos"`;
}

export function publicAvatarSql(enabled?: boolean): string {
  const avatar = "coalesce(profile->>'avatarDataUrl','')";
  return publicProfileValueSql('s','avatar',avatar,"''",enabled);
}

export async function isPublicationWithdrawn(db: PostgresQueries, kind: string, id: string): Promise<boolean> {
  if (process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS === "suppress") return true;
  if (!await hasLocationWithdrawalSchema(db)) return false;
  const result = await db.query("select 1 from app_publication_privacy.location_withdrawals where kind=$1 and publication_id=$2 and scope='publication'", [kind, id]);
  return result.rows.length > 0;
}
