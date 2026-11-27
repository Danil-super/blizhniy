import { createHash } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { AdminPasskeyError } from "./admin-passkey.ts";
import { parseReviewedArchivePasskeyCommand } from "./admin-passkey-contract.ts";
import type { AdminPasskeyStore } from "./postgres-admin-passkey.ts";

function prepare(value: unknown) {
  const { caseId, expectedAdminId, reviewDigest } = parseReviewedArchivePasskeyCommand(value);
  const digest = createHash("sha256").update(JSON.stringify([expectedAdminId, caseId, reviewDigest])).digest("hex");
  return { expectedAdminId, action: { kind: "archive" as const, digest } };
}

export function createAdminArchivePasskey(store: Pick<AdminPasskeyStore, "begin" | "accept">) {
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
