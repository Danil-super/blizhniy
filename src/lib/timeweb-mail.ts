import { domainToASCII } from "node:url";
import nodemailer from "nodemailer";
import type { SendMailOptions, SMTPTransportOptions } from "nodemailer";

const domain = "xn----9sbphbgks4a4a.xn--p1ai";
const sender = `notifications@${domain}`;
export type TimewebMailConfig = { user: string; password: string };
export type TransactionalMail = { id: string; to: string; subject: string; text: string };
export type MailFailureCode = "AUTH_FAILED" | "TEMPORARY" | "REJECTED" | "UNKNOWN";

export class MailError extends Error {
  readonly code: MailFailureCode;
  constructor(code: MailFailureCode = "UNKNOWN") {
    super("Mail operation failed");
    this.name = "MailError";
    this.code = code;
  }
}

function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("Mail requires a server runtime");
}

/** One mailbox, not a display name/list. IDN domains are encoded before the SMTP envelope. */
function mailbox(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 254 || !input.isWellFormed()) return null;
  const parts = input.split("@");
  const local = parts[0];
  if (parts.length !== 2 || local.length > 64 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      local.startsWith(".") || local.endsWith(".") || local.includes("..") || /[\s\u0000-\u001f\u007f/\\:?#\[\]%]/u.test(parts[1])) return null;
  const host = domainToASCII(parts[1]).toLowerCase();
  if (host !== parts[1].toLowerCase() && !/[^\u0000-\u007f]/u.test(parts[1])) return null;
  if (host.length > 253 || !host.includes(".") || host.split(".").some((label) =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  const address = `${local}@${host}`;
  return address.length <= 254 ? address : null;
}

// Shared server-side intake validation; callers canonicalize account local-parts before this boundary.
export { mailbox as normalizeMailAddress };

export function readTimewebMailConfig(env: NodeJS.ProcessEnv = process.env): TimewebMailConfig | null {
  assertServer();
  const mode = env.BLIZHNIY_MAIL_MODE;
  if (mode === undefined && !env.BLIZHNIY_SMTP_USER && !env.BLIZHNIY_SMTP_PASSWORD) return null;
  const user = env.BLIZHNIY_SMTP_USER ?? "";
  const password = env.BLIZHNIY_SMTP_PASSWORD ?? "";
  if (mode !== "timeweb" || mailbox(user) !== sender || !password || password.length > 1024 ||
      !password.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(password) ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === "0" || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("Invalid mail configuration");
  }
  return { user, password };
}

function providerError(error: unknown): MailError {
  const details = error && typeof error === "object" ? error as { code?: unknown; responseCode?: unknown } : {};
  if (details.code === "EAUTH" || details.responseCode === 535) return new MailError("AUTH_FAILED");
  if (typeof details.responseCode === "number" && Number.isInteger(details.responseCode)) {
    if (details.responseCode >= 400 && details.responseCode < 500) return new MailError("TEMPORARY");
    if (details.responseCode >= 500 && details.responseCode < 600) return new MailError("REJECTED");
  }
  // A network timeout may occur after acceptance. Retry policy belongs to the durable outbox.
  return new MailError("UNKNOWN");
}

interface MailTransport {
  verify(): Promise<unknown>;
  sendMail(message: SendMailOptions): Promise<unknown>;
}
export interface TransactionalMailer {
  /** Verifies TLS/authentication; does not send a message or prove end-to-end delivery. */
  verify(): Promise<void>;
  /** SMTP acceptance only, not inbox delivery. One attempt; a stable ID does NOT promise exactly-once. */
  send(message: TransactionalMail): Promise<void>;
}

export function createTimewebMailer(env: NodeJS.ProcessEnv = process.env,
  factory: (options: SMTPTransportOptions) => MailTransport = nodemailer.createTransport): TransactionalMailer | null {
  const config = readTimewebMailConfig(env);
  if (!config) return null;
  // Sources: https://timeweb.cloud/docs/mail/email-clients-configuration and https://nodemailer.com/smtp
  const transport = factory({ host: "smtp.timeweb.ru", port: 465, secure: true, pool: false,
    name: domain, forceAuth: true, auth: { user: sender, pass: config.password },
    tls: { servername: "smtp.timeweb.ru", rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 15000, dnsTimeout: 5000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
  return {
    async verify(): Promise<void> {
      assertServer();
      try {
        if (await transport.verify() !== true) throw new MailError();
      } catch (error) { throw providerError(error); }
    },
    async send(message: TransactionalMail): Promise<void> {
      assertServer();
      const to = mailbox(message?.to);
      if (!message || Object.keys(message).some((key) => !["id", "to", "subject", "text"].includes(key)) || !to ||
          typeof message.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(message.id) ||
          typeof message.subject !== "string" || !message.subject || message.subject.length > 200 ||
          !message.subject.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(message.subject) ||
          typeof message.text !== "string" || !message.text || message.text.length > 16384 ||
          !message.text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message.text)) {
        throw new Error("Invalid mail message");
      }
      try {
        const result = await transport.sendMail({ from: { name: "БЛИЖНИЙ", address: sender }, to: { address: to },
          envelope: { from: sender, to: [to] }, subject: message.subject, text: message.text,
          messageId: `<${message.id}@${domain}>` });
        const response = result as { accepted?: unknown; rejected?: unknown } | null;
        if (!response || !Array.isArray(response.accepted) || response.accepted.length !== 1 || response.accepted[0] !== to ||
            !Array.isArray(response.rejected) || response.rejected.length !== 0) throw new MailError();
      } catch (error) { throw providerError(error); }
    },
  };
}
