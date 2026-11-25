// Local restore drill. Call while the restored fixture is closed and before any new login.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inspectBasicErasureFixture } from "./basic-account-erasure.mjs";

const migrations = [
  "0064-inbox-notification-preferences.sql",
  "0085-business-email.sql",
  "0086-push-subscriptions.sql",
  "0087-push-delivery.sql",
];
const roles = ["blizhniy_runtime", "blizhniy_business_email", "blizhniy_push_worker"];
const locked = "app.notifications,app.sessions,app.email_confirmations,app.password_recoveries,app.telegram_phone_attempts,"+
  "app.mail_outbox,notification_delivery.business_email,app_push.subscriptions,app_push.deliveries";

export async function quarantineRestoredNotifications(db, containerId) {
  try {
    const owned = await inspectBasicErasureFixture(containerId);
    const expected = await Promise.all(migrations.map(async name => ({
      name, sha256: createHash("sha256").update(await readFile(new URL("../database/candidates/" + name, import.meta.url))).digest("hex"),
    })));
    return await db.transaction(async tx => {
      await tx.query("select set_config('search_path','pg_catalog',true),set_config('lock_timeout','2s',true),"+
        "set_config('statement_timeout','3s',true),set_config('transaction_timeout','10s',true)");
      const { rows: [context] } = await tx.query("select current_database() as database,current_user as role,session_user as login,"+
        "current_setting('transaction_read_only') as readonly,current_setting('session_replication_role') as replication,"+
        "current_setting('blizhniy.erasure_fixture',true) as fixture,host(inet_server_addr()) as address,inet_server_port() as port");
      assert.deepEqual(context, { database: "blizhniy_erasure_test", role: "postgres", login: "postgres", readonly: "off", replication: "origin", ...owned });
      const { rows: [offline] } = await tx.query("select count(*)::int=$2 as ready from pg_roles r "+
        "where r.rolname=any($1) and not(r.rolcanlogin or r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls) "+
        "and not exists(select 1 from pg_auth_members m where r.oid in (m.roleid,m.member)) "+
        "and not exists(select 1 from pg_stat_activity a where a.usename=r.rolname and a.datname=current_database())", [roles, roles.length]);
      assert.equal(offline?.ready, true);

      await tx.query("lock table " + locked + " in access exclusive mode");
      const { rows: journal } = await tx.query('select name,sha256 from blizhniy_meta.migrations where name=any($1) order by name collate "C"', [migrations]);
      assert.deepEqual(journal, expected);
      const { rows: cascade } = await tx.query("select (n.nspname||'.'||r.relname) as relation,k.confdeltype as action,"+
        "k.convalidated as validated,k.conenforced as enforced,pg_get_constraintdef(k.oid) as definition from pg_constraint k "+
        "join pg_class r on r.oid=k.conrelid join pg_namespace n on n.oid=r.relnamespace "+
        "where k.contype='f' and k.confrelid in ('app.sessions'::regclass,'app.email_confirmations'::regclass,'app.password_recoveries'::regclass,"+
        "'app.telegram_phone_attempts'::regclass,'app_push.subscriptions'::regclass) "+
        "order by (n.nspname||'.'||r.relname) collate \"C\"");
      assert.deepEqual(cascade, [
        { relation: "app.telegram_phone_attempts", action: "c", validated: true, enforced: true,
          definition: "FOREIGN KEY (session_hash) REFERENCES app.sessions(token_hash) ON DELETE CASCADE" },
        { relation: "app_push.subscriptions", action: "c", validated: true, enforced: true,
          definition: "FOREIGN KEY (session_hash) REFERENCES app.sessions(token_hash) ON DELETE CASCADE" },
      ]);

      // The source may have delivered any restored ready row after the backup.
      const authMail = (await tx.query("update app.mail_outbox set state='unknown',last_code='UNKNOWN',claim_id=null,lease_until=null "+
        "where state in ('ready','reserved','sending')")).rowCount;
      const businessMail = (await tx.query("update notification_delivery.business_email set state='unknown',last_code='UNKNOWN',"+
        "claim_id=null,lease_until=null,updated_at=clock_timestamp() where state in ('ready','sending')")).rowCount;
      const push = (await tx.query("update app_push.deliveries set state='unknown',last_code='unknown',claim_id=null,lease_until=null,"+
        "updated_at=clock_timestamp() where state in ('ready','sending')")).rowCount;
      const confirmations = (await tx.query("delete from app.email_confirmations")).rowCount;
      const recoveries = (await tx.query("delete from app.password_recoveries")).rowCount;
      const sessions = (await tx.query("delete from app.sessions")).rowCount;
      const { rows: [remaining] } = await tx.query("select exists(select 1 from app_push.subscriptions "+
        "union all select 1 from app.telegram_phone_attempts) as present");
      assert.equal(remaining?.present, false);
      return { authMail, businessMail, push, confirmations, recoveries, sessions, reopenAuthorized: false };
    });
  } catch {
    throw new Error("Restored notification preflight failed");
  }
}
