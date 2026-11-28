import { AdminPasskeyError } from "./admin-passkey.ts";
import { hashSessionToken } from "./identity.ts";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

type Principal = { id: string; authVersion: string };

export async function withAdminPasskeySession<T>(db: Pick<PostgresDatabase, "transaction">, token: string,
  work: (tx: PostgresQueries, principal: Principal) => Promise<T>): Promise<T> {
  const hash = hashSessionToken(token);
  if (!hash) throw new AdminPasskeyError();
  try {
    return await db.transaction(async tx => {
      const read = (touch: boolean) => tx.query<Principal>(`select admin_id as id,auth_version::text as "authVersion"
        from app_admin_passkey.session_state($1,$2)`, [hash, touch]);
      const { rows: [actor] } = await read(false);
      if (!actor) throw new AdminPasskeyError();
      const output = await work(tx, actor);
      const { rows: [current] } = await read(true);
      if (!current || current.id !== actor.id || current.authVersion !== actor.authVersion) throw new AdminPasskeyError();
      return output;
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "PAP01") throw new AdminPasskeyError();
    throw error;
  }
}
