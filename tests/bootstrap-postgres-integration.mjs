// Opt-in PostgreSQL 18.6 fixture. No dotenv, remote database or existing container access.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { promisify } from "node:util";
import pg from "pg";
import { bootstrapPostgres, getBootstrapPlan } from "../scripts/bootstrap-postgres.mjs";
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { testCatalog } from "./catalog-integration.mjs";
import { testTariffs } from "./tariffs-integration.mjs";
import { createAdminFixture, testAdminAuthorization } from "./admin-authorization-integration.mjs";
import { testReferenceAdministration } from "./reference-administration-integration.mjs";
import { testMediaMetadata } from "./media-metadata-integration.mjs";
import { testStagingProvision } from "./staging-provision-integration.mjs";

const run = promisify(execFile);
const image = "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873";
const name = `blizhniy-bootstrap-test-${randomBytes(8).toString("hex")}`;
const label = "blizhniy.bootstrap-integration";
const password = randomBytes(24).toString("hex");
const dockerEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", POSTGRES_PASSWORD: password };
const docker = async args => (await run("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
  env: dockerEnv, timeout: 20000, maxBuffer: 1024*1024,
})).stdout.trim();

test("plain PostgreSQL bootstrap: atomic schema, clean references, journal and guarded repeats", { timeout: 120000 }, async suite => {
  let id, client, runtime;
  const otherClients = [];
  try {
    id = await docker(["run", "--detach", "--pull", "never", "--name", name, "--label", `${label}=${name}`,
      "--memory", "512m", "--cpus", "1", "--tmpfs", "/var/lib/postgresql:rw,size=268435456",
      "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=blizhniy_test", image]);
    assert.match(id, /^[a-f0-9]{64}$/);
    const metadata = JSON.parse(await docker(["inspect", id]))[0];
    assert.equal(metadata.Config.Labels[label], name);
    assert.equal(metadata.Config.Image, image);
    const binding = metadata.NetworkSettings.Ports["5432/tcp"][0];
    assert.equal(binding.HostIp, "127.0.0.1");
    const config = { host: "127.0.0.1", port: Number(binding.HostPort), database: "blizhniy_test", user: "postgres", password, ssl: false, connectionTimeoutMillis: 3000 };
    const deadline = Date.now()+20000;
    for (;;) {
      try { await docker(["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "blizhniy_test"]); break; }
      catch { if (Date.now()>deadline) throw new Error("Owned PostgreSQL fixture did not start"); }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    client = new pg.Client(config); await client.connect();
    await testStagingProvision(suite, client, config);
    runtime = createPostgresDatabase({ NODE_ENV: "test", BLIZHNIY_DB_HOST: config.host,
      BLIZHNIY_DB_PORT: String(config.port), BLIZHNIY_DB_NAME: config.database,
      BLIZHNIY_DB_USER: config.user, BLIZHNIY_DB_PASSWORD: password, BLIZHNIY_DB_SSL_MODE: "disable" });
    const target = "127.0.0.1:blizhniy_test";
    const tables = async () => (await client.query("select schemaname,tablename from pg_tables where schemaname not like 'pg_%' and schemaname<>'information_schema' order by 1,2")).rows;

    await suite.test("foreign table and records are preserved rather than adopted", async () => {
      await client.query("create table public.foreign_probe(id integer primary key); insert into public.foreign_probe values(42)");
      await assert.rejects(bootstrapPostgres(client,target), /foreign or untracked/);
      assert.deepEqual((await client.query("select * from public.foreign_probe")).rows,[{id:42}]);
      assert.equal((await tables()).length,1);
      await client.query("drop table public.foreign_probe");
    });
    await suite.test("a failed seed rolls back every migration and the journal", async () => {
      const query = client.query.bind(client);
      client.query = (sql,values) => query(sql.startsWith("insert into app.cities") ? "select $1::jsonb,1/0" : sql,values);
      try { await assert.rejects(bootstrapPostgres(client,target), {code:"22012",message:"PostgreSQL operation failed"}); }
      finally { client.query=query; }
      assert.deepEqual(await tables(),[]);
      assert.equal((await client.query("select count(*)::integer as n from pg_namespace where nspname in ('app','blizhniy_meta')")).rows[0].n,0);
    });
    await suite.test("a view or custom schema does not qualify as an empty database", async () => {
      await client.query("create database bootstrap_guard");
      const guard=new pg.Client({...config,database:"bootstrap_guard"});otherClients.push(guard);await guard.connect();
      await guard.query("create view public.foreign_view as select 42 as n");
      await assert.rejects(bootstrapPostgres(guard,"127.0.0.1:bootstrap_guard"), /foreign or untracked/);
      assert.deepEqual((await guard.query("select * from public.foreign_view")).rows,[{n:42}]);
      await guard.query("drop view public.foreign_view;create schema foreign_namespace");
      await assert.rejects(bootstrapPostgres(guard,"127.0.0.1:bootstrap_guard"), /foreign or untracked/);
    });
    await suite.test("first bootstrap installs seven migrations and no user/payment records", async () => {
      assert.deepEqual(await bootstrapPostgres(client,target), {applied:7,users:0,categories:105,tariffs:7,cities:26,professions:14});
      const recorded=(await client.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
      assert.deepEqual(recorded,getBootstrapPlan().map(({name,sha256})=>({name,sha256})));
      assert.equal((await client.query("select count(*)::integer as n from app.categories where parent_id is null")).rows[0].n,18);
      assert.equal((await tables()).length,15);
      assert.ok((await tables()).every(x=>["app","blizhniy_meta"].includes(x.schemaname)));
      assert.equal((await client.query("select count(*)::integer as n from app.sessions")).rows[0].n,0);
    });
    await testCatalog(suite, runtime);
    await testTariffs(suite, runtime);
    const adminFixture = await createAdminFixture(runtime);
    try {
      await testAdminAuthorization(suite, runtime, client, adminFixture);
      await testReferenceAdministration(suite, runtime, client, adminFixture);
    }
    finally { await adminFixture.cleanup(); }
    await testMediaMetadata(suite, runtime, client);
    await suite.test("repeat preserves IDs, changed price/name/duration and disabled categories", async () => {
      const before=(await client.query("select id from app.categories order by id")).rows;
      await client.query("update app.tariffs set price=321.45,name='Edited reference tariff',duration_days=45,active=false where action='listing_publication'");
      await client.query("update app.categories set name='Edited category',active=false where slug='instrumenty'");
      assert.equal((await bootstrapPostgres(client,target)).applied,0);
      assert.deepEqual((await client.query("select id from app.categories order by id")).rows,before);
      assert.deepEqual((await client.query("select price,name,duration_days,active from app.tariffs where action='listing_publication'")).rows[0],
        {price:"321.45",name:"Edited reference tariff",duration_days:45,active:false});
      assert.deepEqual((await client.query("select name,active from app.categories where slug='instrumenty'")).rows[0],{name:"Edited category",active:false});
    });
    await suite.test("two connections serialize bootstrap without duplicate seeds", async () => {
      const second=new pg.Client(config);otherClients.push(second);await second.connect();
      const results=await Promise.all([bootstrapPostgres(client,target),bootstrapPostgres(second,target)]);
      assert.ok(results.every(x=>x.applied===0&&x.categories===105&&x.tariffs===7));
    });
    await suite.test("changed or incomplete history is refused before seeding", async () => {
      const first=getBootstrapPlan()[0];
      await client.query("update blizhniy_meta.migrations set sha256=$1 where name=$2",["0".repeat(64),first.name]);
      await assert.rejects(bootstrapPostgres(client,target), /journal differs/);
      await client.query("update blizhniy_meta.migrations set sha256=$1 where name=$2",[first.sha256,first.name]);
      const missing=getBootstrapPlan()[1];
      await client.query("delete from blizhniy_meta.migrations where name=$1",[missing.name]);
      await assert.rejects(bootstrapPostgres(client,target), /journal differs/);
      await client.query("insert into blizhniy_meta.migrations(name,sha256) values($1,$2)",[missing.name,missing.sha256]);
    });
    await suite.test("constraints reject invalid money, duration, FK and self-parent", async () => {
      for (const price of ["-0.01","NaN"]) await assert.rejects(client.query("update app.tariffs set price=$1 where action='listing_publication'",[price]),{code:"23514"});
      await assert.rejects(client.query("update app.tariffs set duration_days=0 where action='listing_publication'"),{code:"23514"});
      await assert.rejects(client.query("update app.categories set parent_id=id where slug='instrumenty'"),{code:"23514"});
      await assert.rejects(client.query("update app.cities set region_id='00000000-0000-0000-0000-000000000001'"),{code:"23503"});
    });
    await suite.test("PUBLIC cannot read reference data or the journal", async () => {
      await client.query("create role bootstrap_anonymous nologin");
      for (const table of ["app.tariffs","blizhniy_meta.migrations"]) {
        await client.query("begin;set local role bootstrap_anonymous");
        try { await assert.rejects(client.query(`select * from ${table}`),{code:"42501"}); }
        finally { await client.query("rollback"); }
      }
      await client.query("drop role bootstrap_anonymous");
    });
    await suite.test("lost COMMIT response is not retried or reported as success", async () => {
      await client.query("delete from app.specialist_categories where slug='yurist'");
      const query=client.query.bind(client);let commits=0;
      client.query=async (sql,values)=>{const result=await query(sql,values);if(sql==="commit"){commits++;throw Object.assign(new Error("synthetic lost response"),{code:"ECONNRESET"});}return result;};
      try {await assert.rejects(bootstrapPostgres(client,target),{code:"ECONNRESET",message:"PostgreSQL operation failed"});}
      finally {client.query=query;}
      assert.equal(commits,1);
      assert.equal((await client.query("select count(*)::integer as n from app.specialist_categories")).rows[0].n,14);
    });
    await suite.test("down refuses populated references and works only after fixture-owned rows are cleared", async () => {
      const down=readFileSync(new URL("../database/migrations/0005-reference-catalog.down.sql",import.meta.url),"utf8");
      await assert.rejects(client.query(down),/Refusing to remove populated reference data/);
      await client.query("rollback");
      assert.equal((await client.query("select count(*)::integer as n from app.categories")).rows[0].n,105);
      await client.query("delete from app.categories;delete from app.cities;delete from app.regions;delete from app.specialist_categories;delete from app.tariffs");
      await client.query(readFileSync(new URL("../database/migrations/0007-media-write-attempts.down.sql",import.meta.url),"utf8"));
      await client.query(readFileSync(new URL("../database/migrations/0006-media-reservations.down.sql",import.meta.url),"utf8"));
      await client.query(down);
      assert.equal((await client.query("select to_regclass('app.tariffs') is null as absent")).rows[0].absent,true);
      // Reconcile only this isolated fixture's journal in the same operator-owned environment.
      await client.query("delete from blizhniy_meta.migrations where name in ('0005-reference-catalog.sql','0006-media-reservations.sql','0007-media-write-attempts.sql')");
      assert.equal((await bootstrapPostgres(client,target)).applied,3);
    });
    await suite.test("mail opt-in failure rolls back the new queue, larger rate constraint and all three journal entries", async () => {
      const before = await tables();
      const query = client.query.bind(client);
      client.query = (sql, values) => query(sql.startsWith("insert into app.cities") ? "select $1::jsonb,1/0" : sql, values);
      try { await assert.rejects(bootstrapPostgres(client, target, { includeMail: true }), { code: "22012" }); }
      finally { client.query = query; }
      assert.deepEqual(await tables(), before);
      assert.equal((await client.query("select count(*)::integer as n from blizhniy_meta.migrations")).rows[0].n, 7);
      assert.equal((await client.query("select to_regclass('app.mail_outbox') is null as absent")).rows[0].absent, true);
      assert.equal((await client.query("select count(*)::integer as n from pg_constraint where conname='auth_rate_limits_production_attempts_check'")).rows[0].n, 0);
    });
    await suite.test("explicit mail upgrade journals exact sources once and refuses an implicit downgrade", async () => {
      assert.equal((await bootstrapPostgres(client, target, { includeMail: true })).applied, 3);
      assert.deepEqual((await client.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows,
        getBootstrapPlan({ includeMail: true }).map(({ name, sha256 }) => ({ name, sha256 })));
      await client.query("select state,claim_id,lease_until from app.mail_outbox limit 0");
      assert.equal((await bootstrapPostgres(client, target, { includeMail: true })).applied, 0);
      await assert.rejects(bootstrapPostgres(client, target), /journal differs/);
      assert.equal((await client.query("select count(*)::integer as n from blizhniy_meta.migrations")).rows[0].n, 10);
    });
    const { testPrimaryAuthProvision, testPrimaryProfileGrants } = await import("./primary-auth-provision-integration.mjs");
    const credentials = await testPrimaryAuthProvision(suite, config, client);
    await suite.test("profile permissions cannot be enabled on the older mail-only schema", async () => {
      const { provisionPrimaryProfiles } = await import("../scripts/provision-primary-auth.mjs");
      await assert.rejects(provisionPrimaryProfiles(config, target, credentials, "test"), /preflight/);
      assert.equal((await client.query("select count(*)::integer as n from blizhniy_meta.migrations")).rows[0].n, 10);
      assert.equal((await client.query("select to_regclass('app.cabinet_profiles') is null as absent")).rows[0].absent, true);
    });
    await suite.test("explicit profile upgrade journals only the additive table and preserves the mail prefix", async () => {
      const before = (await client.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
      assert.equal((await bootstrapPostgres(client, target, { includeProfiles: true })).applied, 1);
      const journal = (await client.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
      assert.deepEqual(journal.slice(0,10), before);
      assert.deepEqual(journal, getBootstrapPlan({ includeProfiles: true }).map(({ name, sha256 }) => ({ name, sha256 })));
      assert.equal((await bootstrapPostgres(client, target, { includeProfiles: true })).applied, 0);
      await assert.rejects(bootstrapPostgres(client, target, { includeMail: true }), /journal differs/);
      assert.equal((await client.query("select count(*)::integer as n from app.cabinet_profiles")).rows[0].n, 0);
      assert.equal((await client.query("select has_table_privilege('blizhniy_runtime','app.cabinet_profiles','SELECT') as allowed")).rows[0].allowed, false);
    });
    await testPrimaryProfileGrants(suite, config, client, credentials);
    const { testListingSchema } = await import("./listing-schema-integration.mjs");
    await testListingSchema(suite, client, config, credentials);
    const { testListingDrafts } = await import("./listing-drafts-integration.mjs");
    await testListingDrafts(suite, client, config, credentials);
    const { testListingPhotoSchema } = await import("./listing-photo-schema-integration.mjs");
    await testListingPhotoSchema(suite, client, config, credentials);
    const { testListingPhotos } = await import("./listing-photos-integration.mjs");
    await testListingPhotos(suite, client, config, credentials);
    const { testWorkPublicationSchema } = await import("./work-publication-schema-integration.mjs");
    await testWorkPublicationSchema(suite, client, config, credentials);
    const { testWorkPublicationGrants } = await import("./work-publication-grants-integration.mjs");
    await testWorkPublicationGrants(suite, client, config);
    const { testWorkPublications } = await import("./work-publications-integration.mjs");
    await testWorkPublications(suite, client, config, credentials);
    const { testWorkModeration } = await import("./work-moderation-integration.mjs");
    await testWorkModeration(suite, client, config, credentials);
    const { testPublicWorkStore } = await import("./public-work-store-integration.mjs");
    await testPublicWorkStore(suite, client, config, credentials);
    const { testServicePublicationSchema } = await import("./service-publication-schema-integration.mjs");
    await testServicePublicationSchema(suite, client, config, credentials);
    const { testServicePublicationGrants } = await import("./service-publication-grants-integration.mjs");
    await testServicePublicationGrants(suite, client, config, credentials);
    const { testServicePublications } = await import("./service-publications-integration.mjs");
    await testServicePublications(suite, client, config, credentials);
    const { testServiceModeration } = await import("./service-moderation-integration.mjs");
    await testServiceModeration(suite, client, config, credentials);
    const { testPublicServiceStore } = await import("./public-service-store-integration.mjs");
    await testPublicServiceStore(suite, client, config, credentials);
    const { testInteractionsSchema } = await import("./interactions-schema-integration.mjs");
    await testInteractionsSchema(suite, client, config, credentials);
    const { testInteractionGrants } = await import("./interactions-grants-integration.mjs");
    await testInteractionGrants(suite, client, config, credentials);
    const { testNotificationInbox } = await import("./notification-inbox-integration.mjs");
    await testNotificationInbox(suite, client, config, credentials);
    const { testApplications } = await import("./applications-integration.mjs");
    await testApplications(suite, client, config, credentials);
    const { testBookings } = await import("./bookings-integration.mjs");
    await testBookings(suite, client, config, credentials);
    const { testPublicListingStore } = await import("./public-listing-store-integration.mjs");
    await testPublicListingStore(suite, client, config, credentials);
  } finally {
    if(runtime)await runtime.close();
    await Promise.all(otherClients.map(x=>x.end()));
    if(client)await client.end();
    if(id){
      const metadata=JSON.parse(await docker(["inspect",id]))[0];
      assert.equal(metadata.Id,id);assert.equal(metadata.Config.Labels[label],name);
      assert.equal(metadata.Config.Image,image);assert.equal(metadata.Name,`/${name}`);
      await docker(["rm","--force",id]);
    }
  }
});
