import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const hashPrefix = "scrypt$131072$8$1$";
const hashPattern = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
let activeHashes = 0;

function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("Identity is server-only");
}

function validPassword(password: string): boolean {
  return typeof password === "string" && password.length <= 256 && password.isWellFormed() &&
    !password.includes("\0") && password.trim().length > 0 &&
    [...password].length >= 15 && [...password].length <= 128;
}

async function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  // Bound memory/CPU before enqueueing work in libuv. HTTP rate limits remain mandatory.
  if (activeHashes >= 2) throw new Error("Password hashing capacity exceeded");
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }, (error, key) => {
        if (error) reject(new Error("Password hashing failed"));
        else resolve(key);
      });
    });
  } finally { activeHashes--; }
}

export async function hashPassword(password: string): Promise<string> {
  assertServer();
  if (!validPassword(password)) throw new Error("Invalid password");
  const salt = randomBytes(16);
  const key = await derivePassword(password, salt);
  try { return `${hashPrefix}${salt.toString("hex")}$${key.toString("hex")}`; }
  finally { key.fill(0); }
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  assertServer();
  if (!validPassword(password) || typeof encoded !== "string" || encoded.length > 256) return false;
  const parts = hashPattern.exec(encoded);
  if (!parts) return false;
  const key = await derivePassword(password, Buffer.from(parts[1], "hex"));
  try { return timingSafeEqual(key, Buffer.from(parts[2], "hex")); }
  finally { key.fill(0); }
}

export function generateSessionToken(): string {
  assertServer();
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string | null {
  assertServer();
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  return createHash("sha256").update(token, "utf8").digest("hex");
}
