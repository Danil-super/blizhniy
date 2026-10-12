// Explicit operator command, never invoked by app startup or the deployment pipeline.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readPostgresConfig, PostgresError } from "../src/lib/postgres.ts";
import { region, cities, categories, professions, tariffs } from "../src/lib/data.ts";

const names = ["0001-identity.sql", "0002-registration.sql", "0003-auth-rate-limits.sql",
  "0004-password-recovery.sql", "0005-reference-catalog.sql", "0006-media-reservations.sql", "0007-media-write-attempts.sql"];

export function getBootstrapPlan({ includeMail = false, includeProfiles = false } = {}) {
  if (typeof includeMail !== "boolean" || typeof includeProfiles !== "boolean") throw new Error("Invalid bootstrap option");
  const mail = [...names, "0008-mail-outbox.sql", "0009-mail-delivery.sql", "0010-production-rate-limits.sql"];
  const approved = includeProfiles ? [...mail, "0011-cabinet-profiles.sql"] : includeMail ? mail : names;
  return approved.map(name => {
    const source = readFileSync(new URL(`../database/migrations/${name}`, import.meta.url), "utf8");
    if (!/^begin;$/m.test(source) || !/commit;\s*$/.test(source)) throw new Error("Invalid bootstrap migration");
    return { name, sha256: createHash("sha256").update(source).digest("hex"),
      sql: source.replace(/^begin;\r?\n/m, "").replace(/commit;\s*$/, "") };
  });
}

export function getReferenceSeed() {
  const alphabet = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
  const latin = ["a","b","v","g","d","e","e","zh","z","i","y","k","l","m","n","o","p","r","s","t","u","f","h","ts","ch","sh","shch","","y","","e","yu","ya"];
  const slugify = name => name.toLowerCase().replace(/[а-яё]/g, c => latin[alphabet.indexOf(c)])
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const catalog = categories.flatMap((row, i) => [
    { slug: row.slug, name: row.name, parent_slug: null, sort_order: (i+1)*10 },
    ...row.children.map((name, j) => ({ slug: `${row.slug}-${slugify(name)}`, name, parent_slug: row.slug, sort_order: (j+1)*10 })),
  ]);
  if (new Set(catalog.map(x => x.slug)).size !== catalog.length) throw new Error("Duplicate catalog seed slug");
  return { regions: [{ slug: region.slug, name: region.name }],
    cities: cities.map(x => ({ slug: x.slug, name: x.name, region_slug: x.regionSlug })), categories: catalog,
    professions: professions.map(x => ({ slug: x.slug, name: x.name, parent_name: x.parent, active: x.active })),
    tariffs: tariffs.map(x => ({ id: x.id, action: x.action, name: x.name, price: x.price, duration_days: x.durationDays, active: x.active })) };
}

const seedStatements = [
  ["regions", `insert into app.regions(slug,name) select slug,name from jsonb_to_recordset($1::jsonb) as x(slug text,name text) on conflict(slug) do nothing`],
  ["cities", `insert into app.cities(region_id,slug,name) select r.id,x.slug,x.name from jsonb_to_recordset($1::jsonb) as x(slug text,name text,region_slug text) join app.regions r on r.slug=x.region_slug on conflict(slug) do nothing`],
  ["roots", `insert into app.categories(slug,name,sort_order) select slug,name,sort_order from jsonb_to_recordset($1::jsonb) as x(slug text,name text,sort_order integer) on conflict(slug) do nothing`],
  ["children", `insert into app.categories(parent_id,slug,name,sort_order) select p.id,x.slug,x.name,x.sort_order from jsonb_to_recordset($1::jsonb) as x(slug text,name text,parent_slug text,sort_order integer) join app.categories p on p.slug=x.parent_slug and p.parent_id is null on conflict(slug) do nothing`],
  ["professions", `insert into app.specialist_categories(slug,name,parent_name,active) select slug,name,parent_name,active from jsonb_to_recordset($1::jsonb) as x(slug text,name text,parent_name text,active boolean) on conflict(slug) do nothing`],
  ["tariffs", `insert into app.tariffs(id,action,name,price,duration_days,active) select id,action,name,price,duration_days,active from jsonb_to_recordset($1::jsonb) as x(id text,action text,name text,price numeric,duration_days integer,active boolean) on conflict(action) do nothing`],
];

class BootstrapError extends Error {}

/** Initialize an empty, explicitly confirmed PG18 target, or verify our own journal and seed missing references. */
export async function bootstrapPostgres(client, confirmation, options = {}) {
  const { host, database } = client.connectionParameters;
  if (typeof confirmation !== "string" || confirmation !== `${host}:${database}`) {
    throw new BootstrapError("Missing or mismatched target confirmation");
  }
  const plan = getBootstrapPlan(options);
  const seed = getReferenceSeed();
  let began = false;
  try {
    await client.query("begin"); began = true;
    await client.query("set local lock_timeout='3s'; set local statement_timeout='10s'");
    await client.query("select pg_advisory_xact_lock(187924,1)");
    const { rows: [target] } = await client.query("select current_database() as name,current_setting('server_version_num')::integer as version");
    if (target.name !== database || target.version < 180000 || target.version >= 190000) {
      throw new BootstrapError("Bootstrap requires the confirmed PostgreSQL 18 database");
    }
    const { rows: [journal] } = await client.query("select to_regclass('blizhniy_meta.migrations') is not null as present");
    if (!journal.present) {
      const relations = await client.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
        and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') limit 1`);
      const schemas = await client.query("select 1 from pg_namespace where nspname not like 'pg_%' and nspname not in ('public','information_schema') limit 1");
      const functions = await client.query(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
        and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') limit 1`);
      if (relations.rowCount || schemas.rowCount || functions.rowCount) throw new BootstrapError("Refusing to initialize a foreign or untracked database");
      await client.query(`create schema blizhniy_meta; revoke all on schema blizhniy_meta from public;
        create table blizhniy_meta.migrations(name text primary key,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),applied_at timestamptz not null default now());
        revoke all on blizhniy_meta.migrations from public`);
    }
    const { rows: recorded } = await client.query("select name,sha256 from blizhniy_meta.migrations order by name");
    if (recorded.length > plan.length || recorded.some((row,i) => row.name !== plan[i].name || row.sha256 !== plan[i].sha256)) {
      throw new BootstrapError("Migration journal differs from approved bootstrap sources");
    }
    for (const migration of plan.slice(recorded.length)) {
      // Only fixed, repository-owned SQL is sent using the multi-statement protocol.
      await client.query(migration.sql);
      await client.query("insert into blizhniy_meta.migrations(name,sha256) values($1,$2)", [migration.name,migration.sha256]);
    }
    const payload = { ...seed, roots: seed.categories.filter(x => x.parent_slug === null), children: seed.categories.filter(x => x.parent_slug !== null) };
    for (const [name,sql] of seedStatements) await client.query(sql, [JSON.stringify(payload[name])]);
    const { rows: [counts] } = await client.query(`select (select count(*)::integer from app.users) as users,
      (select count(*)::integer from app.categories) as categories,(select count(*)::integer from app.tariffs) as tariffs,
      (select count(*)::integer from app.cities) as cities,(select count(*)::integer from app.specialist_categories) as professions`);
    await client.query("commit");
    return { applied: plan.length-recorded.length, ...counts };
  } catch (error) {
    if (began) { try { await client.query("rollback"); } catch { /* Connection may already be lost. */ } }
    // A failed COMMIT response is unknown; never automatically retry this command.
    throw error instanceof BootstrapError ? error : new PostgresError(error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--plan", "--plan-mail", "--plan-account"].includes(args[0])) {
    console.log(JSON.stringify({ migrations: getBootstrapPlan({ includeMail: args[0] === "--plan-mail", includeProfiles: args[0] === "--plan-account" }).map(({name,sha256}) => ({name,sha256})),
      references: Object.fromEntries(Object.entries(getReferenceSeed()).map(([name,rows]) => [name,rows.length])) }, null, 2));
    return;
  }
  if (args.length !== 2 || !["--apply", "--apply-mail", "--apply-account"].includes(args[0])) throw new BootstrapError("Usage: bootstrap-postgres.mjs --plan[|-mail|-account] | --apply[|-mail|-account] HOST:DATABASE");
  const config = readPostgresConfig();
  if (args[1] !== `${config.host}:${config.database}`) throw new BootstrapError("Missing or mismatched target confirmation");
  const client = new pg.Client({ ...config, application_name: "blizhniy-bootstrap" });
  try { await client.connect(); console.log(JSON.stringify(await bootstrapPostgres(client, args[1], { includeMail: args[0] === "--apply-mail", includeProfiles: args[0] === "--apply-account" }))); }
  finally { await client.end(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof BootstrapError ? error.message : "PostgreSQL bootstrap failed; inspect target before retrying"); process.exitCode=1; });
}
