import { AuthRequestError } from "./auth-http.ts";
import {
  parseAdminPasskeyEnvelope, parseAdminPasskeyResult, passkeyOperatorErrorStatus, passkeyOperatorRequestLimit,
  parseAdminPasskeyAssertion,
  type AdminPasskeyRequest,
} from "./admin-passkey-contract.ts";
import { requestPrivateJsonOperator } from "./private-json-operator-socket.ts";
import { parseAdminRefundMutation } from "./admin-refund-contract.ts";

export const hostedAdminPasskeySocket = "/run/blizhniy-admin-passkey/operator.sock";

async function call(socketPath: string, token: string, command: AdminPasskeyRequest, signal?: AbortSignal, hostedPath?: string, socketUserAcl = false) {
  const envelope = parseAdminPasskeyEnvelope({ token, command });
  const { status, payload } = await requestPrivateJsonOperator(socketPath, envelope, {
    signal, hostedPath, requestLimit: passkeyOperatorRequestLimit, responseLimit: 32_768, socketUserAcl,
  });
  if (status === 200) return parseAdminPasskeyResult(command, payload);
  const response = payload as { error?: { code?: unknown } } | null;
  const code = response?.error?.code;
  if (typeof code === "string" && code !== "ACCESS_UNAVAILABLE" && Object.hasOwn(passkeyOperatorErrorStatus, code) &&
    passkeyOperatorErrorStatus[code as keyof typeof passkeyOperatorErrorStatus] === status &&
    Object.keys(response ?? {}).join() === "error" && Object.keys(response?.error ?? {}).join() === "code") {
    throw new AuthRequestError(status, code);
  }
  throw new Error("Private passkey operator unavailable");
}

export function callLocalAdminPasskey(socketPath: string, token: string, command: AdminPasskeyRequest, signal?: AbortSignal) {
  return call(socketPath, token, command, signal);
}

export function callHostedAdminPasskey(token: string, command: AdminPasskeyRequest, signal?: AbortSignal) {
  return call(hostedAdminPasskeySocket, token, command, signal, hostedAdminPasskeySocket);
}

export async function authorizeRefundPasskey(token: string, command: unknown, credential: unknown) {
  const result = await call(hostedAdminPasskeySocket, token, {
    action: "refund-approve", command: parseAdminRefundMutation(command), credential: parseAdminPasskeyAssertion(credential),
  }, undefined, hostedAdminPasskeySocket, true);
  if (result.status !== "approved") throw new Error("Private passkey operator unavailable");
}
