// Owned, disposable PostgreSQL only; no dotenv, shared stand or .next output.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import pg from "pg";
import sharp from "sharp";
import { bootstrapPostgres } from "../scripts/bootstrap-postgres.mjs";
import { provisionPrimaryAuth, provisionPrimaryProfiles } from "../scripts/provision-primary-auth.mjs";

const { loadLocalPrimaryModule: load } = createRequire(import.meta.url)("../scripts/local-primary-modules.cjs");
const { createPostgresDatabase } = load("postgres");
const { IdentityStore, hashPassword } = load("identity");
const { PostgresProfileStore, parseProductionProfile, ProfileInputError, ProfileConflictError, ProfileOwnerChangedError } = load("postgres-profile");
const { AppSessionAccessError } = load("app-session-transaction");
const { normalizeProfileAvatar } = load("profile-avatar");
const { createProductionProfileHandler } = load("production-profile-http");
const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const image = "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873";
const name = `blizhniy-avatar-${randomBytes(8).toString("hex")}`, label = "blizhniy.avatar-integration";
const password = randomBytes(24).toString("hex");
const docker = async args => (await run("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
  env: { PATH: process.env.PATH, LANG: "C.UTF-8", POSTGRES_PASSWORD: password }, timeout: 20000, maxBuffer: 1024 * 1024,
})).stdout.trim();
const dataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString("base64")}`;
const photo = () => sharp({ create: { width: 512, height: 512, channels: 3, background: "red" } });

test("avatar normalization: restricted PostgreSQL 18.6 and actual constrained decoder", { timeout: 180000 }, async suite => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(Number(process.versions.node.split(".")[0]), 22);
  const worker = load("media-worker").createLocalMediaWorker(root);
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-avatar-"));
  let id, admin, db;
  try {
    id = await docker(["run", "--detach", "--pull", "never", "--name", name, "--label", `${label}=${name}`,
      "--memory", "512m", "--cpus", "1", "--tmpfs", "/var/lib/postgresql:rw,size=268435456",
      "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=blizhniy_test", image]);
    assert.match(id, /^[a-f0-9]{64}$/);
    const metadata = JSON.parse(await docker(["inspect", id]))[0];
    assert.equal(metadata.Config.Labels[label], name); assert.equal(metadata.Config.Image, image);
    const binding = metadata.NetworkSettings.Ports["5432/tcp"][0]; assert.equal(binding.HostIp, "127.0.0.1");
    const config = { host: "127.0.0.1", port: Number(binding.HostPort), database: "blizhniy_test", user: "postgres", password, ssl: false };
    const deadline = Date.now() + 20000;
    for (;;) {
      try { await docker(["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "blizhniy_test"]); break; }
      catch { if (Date.now() > deadline) throw new Error("Owned PostgreSQL fixture did not start"); }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    admin = new pg.Client(config); await admin.connect();
    assert.match((await admin.query("show server_version")).rows[0].server_version, /^18\.6/);
    await bootstrapPostgres(admin, "127.0.0.1:blizhniy_test", { includeMail: true });
    const credentialFile = join(directory, "runtime.json");
    await provisionPrimaryAuth(config, "127.0.0.1:blizhniy_test", credentialFile, "test");
    const credentials = JSON.parse(readFileSync(credentialFile, "utf8"));
    await bootstrapPostgres(admin, "127.0.0.1:blizhniy_test", { includeProfiles: true });
    await provisionPrimaryProfiles(config, "127.0.0.1:blizhniy_test", credentials, "test");
    db = createPostgresDatabase({ NODE_ENV: "test", BLIZHNIY_DB_HOST: config.host, BLIZHNIY_DB_PORT: String(config.port),
      BLIZHNIY_DB_NAME: config.database, BLIZHNIY_DB_USER: credentials.user,
      BLIZHNIY_DB_PASSWORD: credentials.password, BLIZHNIY_DB_SSL_MODE: "disable" });
    const privileges = (await admin.query("select rolsuper,rolcreaterole,rolcreatedb,rolbypassrls from pg_roles where rolname=$1", [credentials.user])).rows[0];
    assert.deepEqual(privileges, { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
    const identity = new IdentityStore(db), passphrase = "Synthetic avatar integration passphrase!";
    const passwordHash = await hashPassword(passphrase);
    let decodes = 0;
    const normalizeAvatar = avatar => { decodes++; return normalizeProfileAvatar(avatar, async () => worker); };
    const store = new PostgresProfileStore(db, { normalizeAvatar });
    const fixture = async work => {
      const email = `avatar-${randomUUID()}@example.invalid`;
      const account = (await admin.query("insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id", [email, passwordHash])).rows[0];
      try {
        const session = await identity.login(email, passphrase); assert.ok(session);
        const login = async () => { const next = await identity.login(email, passphrase); assert.ok(next); return next.token; };
        await work({ owner: account.id, token: session.token, login });
      } finally { await admin.query("delete from app.users where id=$1", [account.id]); }
    };
    const saved = async owner => (await admin.query("select profile,updated_at from app.cabinet_profiles where user_id=$1", [owner])).rows;
    const claims = async owner => (await admin.query("select email,password_hash,role,is_blocked,auth_version,email_verified_at from app.users where id=$1", [owner])).rows[0];
    const input = avatarDataUrl => parseProductionProfile({ name: "Synthetic Avatar", avatarDataUrl });
    const valid = dataUrl("image/png", await photo().png().toBuffer());

    await suite.test("real JPEG, PNG and WebP persist normalized 512px WebP, strip metadata, preserve identity and skip unchanged saves/removal", async () => fixture(async ({ owner, token }) => {
      const before = await claims(owner); let revision = null;
      for (const format of ["jpeg", "png", "webp"]) {
        const bytes = await photo().withMetadata({ orientation: 6 })[format]().toBuffer();
        assert.ok((await sharp(bytes).metadata()).exif);
        const calls = decodes;
        const result = await store.write(token, owner, input(dataUrl(`image/${format}`, bytes)), revision);
        assert.equal(decodes, calls + 1); assert.match(result.profile.avatarDataUrl, /^data:image\/webp;base64,/);
        const output = Buffer.from(result.profile.avatarDataUrl.split(",")[1], "base64");
        assert.ok(output.length > 0 && output.length <= 300 * 1024); assert.equal(output.equals(bytes), false);
        const meta = await sharp(output).metadata();
        assert.equal(meta.format, "webp"); assert.equal(meta.width, 512); assert.equal(meta.height, 512);
        for (const key of ["exif", "icc", "iptc", "xmp"]) assert.equal(meta[key], undefined);
        assert.equal((await sharp(output).raw().toBuffer()).length, 512 * 512 * 3);
        assert.equal((await saved(owner))[0].profile.avatarDataUrl === result.profile.avatarDataUrl, true);
        const reread = await store.read(token, owner); assert.equal(reread.profile.avatarDataUrl === result.profile.avatarDataUrl, true);
        const next = await store.write(token, owner, parseProductionProfile({ ...result.profile, city: "Москва" }), result.revision);
        assert.equal(decodes, calls + 1); assert.equal(next.profile.avatarDataUrl === result.profile.avatarDataUrl, true);
        revision = next.revision;
      }
      const calls = decodes;
      const removed = await store.write(token, owner, input(""), revision);
      assert.equal(removed.profile.avatarDataUrl, ""); assert.equal(decodes, calls);
      assert.equal((await store.read(token, owner)).profile.avatarDataUrl, ""); assert.deepEqual(await claims(owner), before);
    }));

    await suite.test("signature-only and header-readable truncated pixels reject without changing PostgreSQL; real HTTP returns 422", async () => fixture(async ({ owner, token }) => {
      const initial = await store.write(token, owner, input(valid), null), before = await saved(owner);
      const png = await photo().png().toBuffer(), truncated = png.subarray(0, Math.floor(png.length / 2));
      assert.equal((await sharp(truncated).metadata()).width, 512);
      const malformed = [dataUrl("image/jpeg", Buffer.from([255, 216, 255])), dataUrl("image/png", png.subarray(0, 8)),
        dataUrl("image/webp", Buffer.from("RIFF0000WEBP")), dataUrl("image/png", truncated)];
      for (const avatar of malformed) {
        await assert.rejects(store.write(token, owner, input(avatar), initial.revision), ProfileInputError);
        assert.deepEqual(await saved(owner), before);
      }
      const { AuthRateLimiter } = load("auth-http");
      const origin = "https://avatar.example.invalid";
      const handler = createProductionProfileHandler({ origin }, () => ({ store, limiter: new AuthRateLimiter(db, randomBytes(32).toString("hex")) }), () => {});
      const response = await handler(new Request(`${origin}/api/account/profile`, { method: "PUT", headers: {
        host: new URL(origin).host, origin, "content-type": "application/json", "x-blizhniy-request": "1", "x-real-ip": "192.0.2.71",
        cookie: `__Host-blizhniy_session=${token}`,
      }, body: JSON.stringify({ expectedOwnerId: owner, expectedRevision: initial.revision, profile: input(malformed[3]) }) }));
      assert.equal(response.status, 422); assert.deepEqual(await response.json(), { error: { code: "INVALID_INPUT" } });
      assert.deepEqual(await saved(owner), before);
    }));

    await suite.test("owner, stale revision, revoked session and blocked user fail before decoder admission", async () => fixture(async ({ owner, token, login }) => {
      const initial = await store.write(token, owner, input(valid), null), before = await saved(owner), calls = decodes;
      await assert.rejects(store.write(token, randomUUID(), input(valid), initial.revision), ProfileOwnerChangedError);
      await assert.rejects(store.write(token, owner, input(valid), null), ProfileConflictError);
      await identity.revokeSession(token);
      await assert.rejects(store.write(token, owner, input(valid), initial.revision), AppSessionAccessError);
      const live = await login(); await admin.query("update app.users set is_blocked=true where id=$1", [owner]);
      await assert.rejects(store.write(live, owner, input(valid), initial.revision), AppSessionAccessError);
      assert.equal(decodes, calls); assert.deepEqual(await saved(owner), before);
    }));

    await suite.test("actual busy/aborted decoder and malformed replies preserve the previous row", async () => fixture(async ({ owner, token }) => {
      const initial = await store.write(token, owner, input(valid), null), before = await saved(owner);
      const jpeg = await photo().jpeg().toBuffer(), replacement = input(dataUrl("image/jpeg", jpeg));
      const busy = new PostgresProfileStore(db, { normalizeAvatar: async avatar => {
        const running = worker.normalize(jpeg, "image/jpeg");
        try { return await normalizeProfileAvatar(avatar, async () => worker); } finally { await running; }
      } });
      await assert.rejects(busy.write(token, owner, replacement, initial.revision), /Avatar processing unavailable/);
      const aborted = new AbortController(); aborted.abort();
      for (const normalize of [avatar => normalizeProfileAvatar(avatar, async () => worker, aborted.signal),
        avatar => normalizeProfileAvatar(avatar, async () => ({ normalize: async () => ({ bytes: Buffer.from("invalid"), mimeType: "image/webp" }) }))]) {
        await assert.rejects(new PostgresProfileStore(db, { normalizeAvatar: normalize }).write(token, owner, replacement, initial.revision), /Avatar processing unavailable/);
      }
      assert.deepEqual(await saved(owner), before);
    }));

    await suite.test("concurrent content change and session revocation during normalization refuse final commit without holding row locks", async () => {
      for (const mutation of ["profile", "session"]) await fixture(async ({ owner, token }) => {
        const initial = await store.write(token, owner, input(""), null);
        let enter, release;
        const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
        const deferred = new PostgresProfileStore(db, { normalizeAvatar: async avatar => { enter(); await gate; return normalizeAvatar(avatar); } });
        const rejected = assert.rejects(deferred.write(token, owner, input(valid), initial.revision), mutation === "profile" ? ProfileConflictError : AppSessionAccessError);
        await entered;
        try {
          await admin.query("set statement_timeout='2s'");
          if (mutation === "profile") await store.write(token, owner, parseProductionProfile({ name: "Concurrent Winner" }), initial.revision);
          else await identity.revokeSession(token);
        } finally { release(); }
        const before = await saved(owner); await rejected; assert.deepEqual(await saved(owner), before);
      });
    });

    await suite.test("database trigger failure rolls back normalized avatar write and does not retry", async () => fixture(async ({ owner, token }) => {
      const initial = await store.write(token, owner, input(""), null), before = await saved(owner), calls = decodes;
      await admin.query("create function app.avatar_failure_probe() returns trigger language plpgsql as $$ begin raise exception 'Synthetic avatar write failure' using errcode='23514'; end $$");
      await admin.query("create trigger avatar_failure_probe before update on app.cabinet_profiles for each row execute function app.avatar_failure_probe()");
      try {
        await assert.rejects(store.write(token, owner, input(valid), initial.revision), { code: "23514" });
        assert.equal(decodes, calls + 1); assert.deepEqual(await saved(owner), before);
      } finally { await admin.query("drop trigger avatar_failure_probe on app.cabinet_profiles"); await admin.query("drop function app.avatar_failure_probe()"); }
    }));
  } finally {
    try { await db?.close(); await admin?.end(); }
    finally {
      rmSync(directory, { recursive: true, force: true });
      if (id) {
        const metadata = JSON.parse(await docker(["inspect", id]))[0];
        if (metadata.Id !== id || metadata.Name !== `/${name}` || metadata.Config.Labels[label] !== name) throw new Error("Refusing foreign container cleanup");
        await docker(["rm", "--force", id]);
      }
    }
  }
});
