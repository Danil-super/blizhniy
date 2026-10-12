import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createTimewebMailer, readTimewebMailConfig, MailError } from "../src/lib/timeweb-mail.ts";

/** A private JSON file, not dotenv or shell syntax. Never copy arbitrary keys into process.env. */
export function loadPrivateSmtpConfig(path) {
  let descriptor;
  try {
    if (typeof path !== "string" || !isAbsolute(path)) throw new Error();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size > 4096) throw new Error();
    const buffer = Buffer.alloc(4097);
    let length = 0;
    while (length < buffer.length) {
      const bytes = readSync(descriptor, buffer, length, buffer.length-length, null);
      if (!bytes) break;
      length += bytes;
    }
    if (length > 4096) throw new Error();
    const config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
    const keys = ["BLIZHNIY_MAIL_MODE", "BLIZHNIY_SMTP_USER", "BLIZHNIY_SMTP_PASSWORD"];
    if (!config || Array.isArray(config) || Object.keys(config).length !== keys.length ||
        keys.some((key) => typeof config[key] !== "string") || !readTimewebMailConfig(config)) throw new Error();
    return Object.fromEntries(keys.map((key) => [key, config[key]]));
  } catch {
    throw new Error("Invalid private mail configuration");
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error();
    const mailer = createTimewebMailer(loadPrivateSmtpConfig(process.argv[2]));
    if (!mailer) throw new Error();
    await mailer.verify();
    process.stdout.write(`${JSON.stringify({ smtp: "authenticated", messageSent: false })}\n`);
  } catch (error) {
    const code = error instanceof MailError ? error.code : "CONFIG_INVALID";
    process.stderr.write(`SMTP check failed (${code}); no message sent\n`);
    process.exitCode = 1;
  }
}
