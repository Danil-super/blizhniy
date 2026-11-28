import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { AdminPasskeyError, createAdminPasskeyOptions, verifyAdminPasskeyAssertion } from "./admin-passkey.ts";
import { withAdminPasskeySession } from "./admin-passkey-session.ts";
import { hashSessionToken } from "./identity.ts";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

type AdminAction = {
  kind: "archive" | "user-access" | "refund";
  digest: string;
};

type Credential = { id: string; userHandle: string; publicKey: Buffer; counter: number };
type Approval = { authVersion: string; credentialId: string };

function authorization(token: string, action: AdminAction) {
  const session = hashSessionToken(token);
  if (!session || !["archive", "user-access", "refund"].includes(action.kind) || !/^[a-f0-9]{64}$/.test(action.digest)) {
    throw new AdminPasskeyError();
  }
  return { session, kind: action.kind, digest: action.digest };
}

export class AdminPasskeyStore {
  private readonly db: Pick<PostgresDatabase, "transaction">;
  private readonly origin: string;

  constructor(db: Pick<PostgresDatabase, "transaction">, origin: string) {
    this.db = db;
    this.origin = origin;
  }

  async begin(token: string, action: AdminAction, expectedAdminId?: string) {
    const { session, kind, digest } = authorization(token, action);
    return withAdminPasskeySession(this.db, token, async (tx, user) => {
      if (expectedAdminId !== undefined && expectedAdminId !== user.id) throw new AdminPasskeyError();
      const { rows } = await tx.query<{ id: string }>(`select id from app_admin_passkey.credentials
        where admin_id=$1 and revoked_at is null order by id limit 17`, [user.id]);
      if (rows.length > 16) throw new AdminPasskeyError();
      const credentialIds = rows.map(row => row.id);
      const options = await createAdminPasskeyOptions(this.origin, credentialIds);
      await tx.query(`insert into app_admin_passkey.challenges(session_hash,auth_version,kind,command_digest,credential_ids,challenge,expires_at)
        values($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '90 seconds')
        on conflict(session_hash) do update set auth_version=excluded.auth_version,kind=excluded.kind,
          command_digest=excluded.command_digest,credential_ids=excluded.credential_ids,
          challenge=excluded.challenge,expires_at=excluded.expires_at`,
      [session, user.authVersion, kind, digest, credentialIds, options.challenge]);
      return options;
    });
  }

  /** Work records only transactional database effects. External delivery uses the committed result. */
  async accept<T>(token: string, action: AdminAction, assertion: AuthenticationResponseJSON,
    work: (tx: PostgresQueries, adminId: string, approval: Approval) => Promise<T>): Promise<T> {
    const { session, kind, digest } = authorization(token, action);
    if (typeof assertion?.id !== "string" || !/^[A-Za-z0-9_-]{1,1364}$/.test(assertion.id)) throw new AdminPasskeyError();
    return withAdminPasskeySession(this.db, token, async (tx, user) => {
      const { rows: [pending] } = await tx.query<{ challenge: string }>(`select challenge from app_admin_passkey.challenges
        where session_hash=$1 and auth_version=$2 and kind=$3 and command_digest=$4
          and $5=any(credential_ids) and expires_at>clock_timestamp()
        for update`, [session, user.authVersion, kind, digest, assertion.id]);
      if (!pending) throw new AdminPasskeyError();
      const { rows: [credential] } = await tx.query<Credential>(`select id,user_handle as "userHandle",public_key as "publicKey",
        counter::double precision as counter from app_admin_passkey.credentials
        where admin_id=$1 and id=$2 and revoked_at is null for update`, [user.id, assertion.id]);
      if (!credential) throw new AdminPasskeyError();
      const counter = await verifyAdminPasskeyAssertion({
        origin: this.origin, challenge: pending.challenge,
        credential: { id: credential.id, counter: credential.counter, publicKey: Uint8Array.from(credential.publicKey) },
        userHandle: credential.userHandle, assertion,
      });
      await tx.query("update app_admin_passkey.credentials set counter=$2 where id=$1", [credential.id, counter]);
      const result = await work(tx, user.id, { authVersion: user.authVersion, credentialId: credential.id });
      const consumed = await tx.query(`delete from app_admin_passkey.challenges
        where session_hash=$1 and challenge=$2 and expires_at>clock_timestamp()`, [session, pending.challenge]);
      if (consumed.rowCount !== 1) throw new AdminPasskeyError();
      return result;
    });
  }
}
