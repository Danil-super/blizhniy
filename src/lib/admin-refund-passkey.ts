import { createHash } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { AdminPasskeyError } from "./admin-passkey.ts";
import { parseAdminRefundMutation } from "./admin-refund-contract.ts";
import type { AdminPasskeyStore } from "./postgres-admin-passkey.ts";

function prepare(value: unknown) {
  const command = parseAdminRefundMutation(value);
  const digest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  return { expectedAdminId: command.expectedAdminId, action: { kind: "refund" as const, digest } };
}

export function createAdminRefundPasskey(store: Pick<AdminPasskeyStore, "begin" | "accept">) {
  return {
    begin(token: string, value: unknown) {
      const { expectedAdminId, action } = prepare(value);
      return store.begin(token, action, expectedAdminId);
    },
    approve(token: string, value: unknown, credential: AuthenticationResponseJSON) {
      const { expectedAdminId, action } = prepare(value);
      return store.accept(token, action, credential, async (_tx, administrator) => {
        if (administrator !== expectedAdminId) throw new AdminPasskeyError();
      });
    },
  };
}
