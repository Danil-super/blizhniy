import { AuthRequestError } from "./auth-http.ts";
import { deletionId, deletionObject, DeletionInputError } from "./account-deletion-contract.ts";
import { parseAdminUserAccessCommand } from "./admin-user-access-contract.ts";
import { parseAdminRefundMutation } from "./admin-refund-contract.ts";

export const passkeyOperatorRequestLimit = 33_792;
export const passkeyOperatorErrorStatus = {
  ACCESS_UNAVAILABLE: 503, PASSKEY_REQUIRED: 403, INVALID_INPUT: 422, NOT_FOUND: 404,
} as const;

function invalid(): never { throw new AuthRequestError(422, "INVALID_INPUT"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  return value as Record<string, unknown>;
}
function exact(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) invalid();
}
function encoded(value: unknown, min: number, max: number) {
  if (typeof value !== "string" || value.length < min || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  return value;
}

function credential(value: unknown) {
  const row = record(value), details = record(row.response);
  const id = encoded(row.id, 1, 1364);
  if (row.rawId !== id || row.type !== "public-key") invalid();
  return {
    common: { id, rawId: id, type: "public-key" as const, clientExtensionResults: {} },
    details,
    clientDataJSON: encoded(details.clientDataJSON, 1, 8192),
  };
}

export function parseAdminPasskeyAssertion(value: unknown) {
  const { common, details, clientDataJSON } = credential(value);
  const userHandle = details.userHandle == null ? undefined : encoded(details.userHandle, 1, 86);
  return { ...common, response: { clientDataJSON, userHandle,
    authenticatorData: encoded(details.authenticatorData, 1, 8192), signature: encoded(details.signature, 1, 2048) } };
}

export function parseArchivePasskeyCommand(value: unknown) {
  const row = deletionObject(value, ["caseId", "expectedAdminId"]);
  if (typeof row.caseId !== "string" || !/^[A-Za-z0-9_-]{6,80}$/.test(row.caseId)) throw new DeletionInputError();
  return { caseId: row.caseId, expectedAdminId: deletionId(row.expectedAdminId) };
}

export function parseReviewedArchivePasskeyCommand(value: unknown) {
  const row = record(value);
  exact(row, ["caseId", "expectedAdminId", "reviewDigest"]);
  if (typeof row.reviewDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.reviewDigest)) invalid();
  return { ...parseArchivePasskeyCommand({ caseId: row.caseId, expectedAdminId: row.expectedAdminId }), reviewDigest: row.reviewDigest };
}

export function parseAdminPasskeyRequest(raw: unknown) {
  const row = record(raw);
  switch (row.action) {
    case "enroll-options":
      exact(row, ["action", "code"]);
      return { action: row.action, code: encoded(row.code, 43, 43) };
    case "enroll-finish": {
      exact(row, ["action", "code", "credential"]);
      const { common, details, clientDataJSON } = credential(row.credential);
      return { action: row.action, code: encoded(row.code, 43, 43),
        credential: { ...common, response: { clientDataJSON, attestationObject: encoded(details.attestationObject, 1, 24_000) } } };
    }
    case "access-options":
    case "access-approve": {
      const action = row.action;
      exact(row, action === "access-options" ? ["action", "command"] : ["action", "command", "credential"]);
      const command = parseAdminUserAccessCommand(row.command);
      if (command.action !== "change") invalid();
      if (action === "access-options") return { action, command };
      return { action, command, credential: parseAdminPasskeyAssertion(row.credential) };
    }
    case "archive-options":
    case "archive-approve": {
      const action = row.action;
      exact(row, action === "archive-options" ? ["action", "command"] : ["action", "command", "credential"]);
      const command = parseReviewedArchivePasskeyCommand(row.command);
      if (action === "archive-options") return { action, command };
      return { action, command, credential: parseAdminPasskeyAssertion(row.credential) };
    }
    case "refund-options":
    case "refund-approve": {
      const action = row.action;
      exact(row, action === "refund-options" ? ["action", "command"] : ["action", "command", "credential"]);
      const command = parseAdminRefundMutation(row.command);
      if (action === "refund-options") return { action, command };
      return { action, command, credential: parseAdminPasskeyAssertion(row.credential) };
    }
    default: return invalid();
  }
}

export type AdminPasskeyRequest = ReturnType<typeof parseAdminPasskeyRequest>;

export function parseAdminPasskeyEnvelope(value: unknown) {
  const row = record(value);
  exact(row, ["token", "command"]);
  if (typeof row.token !== "string" || !/^[a-f0-9]{64}$/.test(row.token)) invalid();
  return { token: row.token, command: parseAdminPasskeyRequest(row.command) };
}

export function parseAdminPasskeyOptions(value: unknown) {
  const row = record(value);
  exact(row, ["options"]);
  encoded(record(row.options).challenge, 43, 43);
  return row;
}

export function parseAdminPasskeyResult(input: AdminPasskeyRequest, value: unknown) {
  try {
    if (input.action === "enroll-options" || input.action === "access-options" || input.action === "archive-options" || input.action === "refund-options") {
      return parseAdminPasskeyOptions(value);
    }
    const row = record(value);
    exact(row, ["status"]);
    if (row.status !== (input.action === "enroll-finish" ? "enrolled" : "approved")) invalid();
    return row;
  } catch {
    throw new Error("Invalid private passkey reply");
  }
}
