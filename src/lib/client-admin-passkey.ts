"use client";

import type { AdminUserAccessCommand } from "./admin-user-access-contract.ts";
import type { AdminRefundMutation } from "./admin-refund-contract.ts";

const endpoint = "/api/admin/passkey";
export class AdminPasskeyClientError extends Error {}

async function readPasskeyJson(response: Response): Promise<unknown> {
  if (!response.body || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new AdminPasskeyClientError("Не удалось получить ответ о ключе администратора.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "", complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { complete = true; return JSON.parse(text + decoder.decode()) as unknown; }
      size += value.byteLength;
      if (size > 32_768) throw new AdminPasskeyClientError("Ответ сервера превышает допустимый размер.");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try { if (!complete) await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

async function post<T>(body: object, signal?: AbortSignal, route = endpoint): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(route, {
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" },
    body: JSON.stringify(body),
  });
  const result = await readPasskeyJson(response);
  if (!response.ok) {
    const error = result as { error?: { code?: string } } | null;
    if (response.status === 403 && error?.error?.code === "PASSKEY_REQUIRED") {
      throw new AdminPasskeyClientError("Ключ или код подтверждения недействителен. Начните подтверждение заново.");
    }
    throw new AdminPasskeyClientError("Подтверждение ключом сейчас недоступно.");
  }
  return result as T;
}

function browser() {
  if (typeof PublicKeyCredential !== "function" || !navigator.credentials ||
    typeof PublicKeyCredential.parseCreationOptionsFromJSON !== "function" ||
    typeof PublicKeyCredential.parseRequestOptionsFromJSON !== "function" ||
    typeof PublicKeyCredential.prototype.toJSON !== "function") {
    throw new AdminPasskeyClientError("Для ключей администратора нужен браузер с поддержкой WebAuthn.");
  }
  return PublicKeyCredential;
}

async function getAssertion(requestOptions: () => Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>, signal?: AbortSignal) {
  const Key = browser();
  const { options } = await requestOptions();
  if (options.rpId !== location.hostname || options.userVerification !== "required") {
    throw new AdminPasskeyClientError("Подтверждение ключом недоступно для этого сайта.");
  }
  const key = await navigator.credentials.get({ publicKey: Key.parseRequestOptionsFromJSON(options), signal });
  if (!(key instanceof Key)) throw new AdminPasskeyClientError("Действие не подтверждено ключом.");
  return key.toJSON();
}

export const adminPasskeys = {
  async enroll(code: string, signal?: AbortSignal) {
    const Key = browser();
    const { options } = await post<{ options: PublicKeyCredentialCreationOptionsJSON }>({ action: "enroll-options", code }, signal);
    if (options.rp.id !== location.hostname || options.authenticatorSelection?.userVerification !== "required") {
      throw new AdminPasskeyClientError("Регистрация ключа недоступна для этого сайта.");
    }
    const key = await navigator.credentials.create({ publicKey: Key.parseCreationOptionsFromJSON(options), signal });
    if (!(key instanceof Key)) throw new AdminPasskeyClientError("Регистрация ключа не подтверждена.");
    const result = await post<{ status: string }>({ action: "enroll-finish", code, credential: key.toJSON() }, signal);
    if (result.status !== "enrolled") throw new AdminPasskeyClientError("Результат регистрации ключа не подтверждён.");
  },
  async approveAccess(command: Extract<AdminUserAccessCommand, { action: "change" }>, signal?: AbortSignal) {
    const credential = await getAssertion(() => post({ action: "access-options", command }, signal), signal);
    const result = await post<{ status: string }>({ action: "access-approve", command, credential }, signal);
    if (result.status !== "approved") throw new AdminPasskeyClientError("Подтверждение ключом не получено.");
  },
  archiveAssertion(command: { caseId: string; expectedAdminId: string }, signal?: AbortSignal) {
    return getAssertion(() => post({ action: "options", ...command }, signal, "/api/admin/account-export"), signal);
  },
  refundAssertion(command: AdminRefundMutation, signal?: AbortSignal) {
    return getAssertion(() => post({ action: "refund-options", command }, signal), signal);
  },
};
