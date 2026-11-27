import { createHash } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { AdminPasskeyError } from "./admin-passkey.ts";
import { parseAdminUserAccessCommand } from "./admin-user-access-contract.ts";
import { hashSessionToken } from "./identity.ts";
import type { AdminPasskeyStore } from "./postgres-admin-passkey.ts";

function prepareChange(value: unknown) {
  const command = parseAdminUserAccessCommand(value);
  if (command.action !== "change") throw new AdminPasskeyError();
  const input = command.input;
  // Match jsonb_build_array in the operator's guarded SQL function.
  const operands = JSON.stringify([command.expectedAdminId, input.targetId, input.id,
    input.expectedVersion, input.role, input.isBlocked, input.reason]);
  return { command, operands, action: { kind: "user-access" as const,
    digest: createHash("sha256").update(operands).digest("hex") } };
}

export function createAdminUserAccessPasskey(store: Pick<AdminPasskeyStore, "begin" | "accept">) {
  return {
    begin(token: string, value: unknown) {
      return store.begin(token, prepareChange(value).action);
    },
    async approve(token: string, value: unknown, assertion: AuthenticationResponseJSON) {
      const { command, operands, action } = prepareChange(value);
      const session = hashSessionToken(token);
      if (!session) throw new AdminPasskeyError();
      await store.accept(token, action, assertion, async (tx, adminId, proof) => {
        if (adminId !== command.expectedAdminId) throw new AdminPasskeyError();
        const { rows: [stored] } = await tx.query<{ ok: boolean }>(`
          select app_admin_passkey.store_access_permit($1,$2,$3,$4::jsonb) as ok`,
        [session, proof.authVersion, proof.credentialId, operands]);
        if (stored?.ok !== true) throw new AdminPasskeyError();
      });
    },
  };
}
