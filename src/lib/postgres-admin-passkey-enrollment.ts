import { createHash, randomBytes } from "node:crypto";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { AdminPasskeyError, adminPasskeyRelyingParty, createAdminPasskeyRegistration, verifyAdminPasskeyRegistration } from "./admin-passkey.ts";
import { withAdminPasskeySession } from "./admin-passkey-session.ts";
import { hashSessionToken } from "./identity.ts";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

type EnrollmentMode = "add" | "replace";
const digest = (code: string) => createHash("sha256").update(code).digest("hex");
const enrollmentState = `select mode,challenge from app_admin_passkey.enrollment_state($1,$2,$3)`;
type EnrollmentState = { mode: EnrollmentMode; challenge: string | null };

function enrollmentAccess(token: string, code: string) {
  const session = hashSessionToken(token);
  if (!session || typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new AdminPasskeyError();
  return { session, codeHash: digest(code) };
}

/** Only a trusted issuer with independently verified approval may give this code to the administrator. */
export async function issueAdminPasskeyApproval(db: PostgresQueries, adminId: string, origin: string, mode: EnrollmentMode) {
  adminPasskeyRelyingParty(origin);
  if (typeof adminId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(adminId) ||
    (mode !== "add" && mode !== "replace")) throw new AdminPasskeyError();
  const code = randomBytes(32).toString("base64url");
  const result = await db.query(`insert into app_admin_passkey.enrollments(admin_id,auth_version,origin,code_hash,mode,expires_at)
    select id,auth_version,$2,$3,$4,clock_timestamp()+interval '5 minutes'
      from app.users where id=$1 and role='admin' and not is_blocked and email_verified_at is not null for update
    on conflict(admin_id) do update set auth_version=excluded.auth_version,origin=excluded.origin,code_hash=excluded.code_hash,
      mode=excluded.mode,expires_at=excluded.expires_at,session_hash=null,user_handle=null,challenge=null,challenge_expires_at=null`,
  [adminId, origin, digest(code), mode]);
  if (result.rowCount !== 1) throw new AdminPasskeyError();
  return code;
}

export class AdminPasskeyEnrollment {
  private readonly db: Pick<PostgresDatabase, "transaction">;
  private readonly origin: string;

  constructor(db: Pick<PostgresDatabase, "transaction">, origin: string) {
    adminPasskeyRelyingParty(origin);
    this.db = db;
    this.origin = origin;
  }

  async begin(token: string, code: string) {
    const { session, codeHash } = enrollmentAccess(token, code);
    return withAdminPasskeySession(this.db, token, async (tx, user) => {
      const binding = [session, this.origin, codeHash];
      const { rows: [approval] } = await tx.query<EnrollmentState>(enrollmentState, binding);
      if (!approval || approval.challenge !== null) throw new AdminPasskeyError();

      const { rows: [existing] } = await tx.query<{ user_handle: string }>(`select user_handle from app_admin_passkey.credentials
        where admin_id=$1 order by created_at,id limit 1`, [user.id]);
      const { rows: active } = await tx.query<{ id: string }>(`select id from app_admin_passkey.credentials
        where admin_id=$1 and revoked_at is null order by id limit 17`, [user.id]);
      if (active.length > 16 || (approval.mode === "add" && active.length === 16)) throw new AdminPasskeyError();
      const userHandle = existing?.user_handle ?? randomBytes(32).toString("base64url");
      const options = await createAdminPasskeyRegistration(this.origin, userHandle, active.map(row => row.id));
      const { rows: [started] } = await tx.query<{ ok: boolean }>(`select app_admin_passkey.bind_enrollment($1,$2,$3,$4,$5) as ok`,
      [...binding, userHandle, options.challenge]);
      if (started?.ok !== true) throw new AdminPasskeyError();
      return options;
    });
  }

  async finish(token: string, code: string, response: RegistrationResponseJSON) {
    const { session, codeHash } = enrollmentAccess(token, code);
    await withAdminPasskeySession(this.db, token, async tx => {
      const binding = [session, this.origin, codeHash];
      const { rows: [pending] } = await tx.query<EnrollmentState>(enrollmentState, binding);
      if (!pending?.challenge) throw new AdminPasskeyError();
      const credential = await verifyAdminPasskeyRegistration(this.origin, pending.challenge, response);
      const { rows: [stored] } = await tx.query<{ ok: boolean }>(`
        select app_admin_passkey.complete_enrollment($1,$2,$3,$4,$5,$6,$7) as ok`,
      [...binding, pending.challenge, credential.id, Buffer.from(credential.publicKey), credential.counter]);
      if (stored?.ok !== true) throw new AdminPasskeyError();
    });
  }
}
