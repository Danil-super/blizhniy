import { createDefaultCabinetProfile, type CabinetProfile } from "./cabinet-profile";
import { withAppSessionTransaction } from "./app-session-transaction";
import type { PostgresDatabase, PostgresQueries } from "./postgres";

export class ProfileInputError extends Error {
  constructor() { super("Invalid profile input"); this.name = "ProfileInputError"; }
}
export class ProfileOwnerChangedError extends Error {
  constructor() { super("Profile owner changed"); this.name = "ProfileOwnerChangedError"; }
}
export type StoredCabinetProfile = Omit<CabinetProfile, "email" | "phoneVerified" | "verifiedPhone">;
const textLimits = { name: 120, phone: 40, city: 80, organizationName: 120, organizationInn: 12,
  organizationOgrn: 15, organizationAddress: 160, organizationWebsite: 120, organizationDescription: 500 } as const;
const ranges = { avatarZoom: [1, 5], avatarPositionX: [0, 100], avatarPositionY: [0, 100] } as const;
const booleans = ["notifyBookings", "notifyMessages", "notifyPayments", "notifyPublicationStatus", "notifySystem",
  "emailNotifications", "pushNotifications"] as const;

/** Full replacement with defaults for omitted settings. Identity/verification claims are never persisted. */
export function parseProductionProfile(value: unknown): StoredCabinetProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProfileInputError();
  const input = value as Record<string, unknown>;
  const allowed = new Set([...Object.keys(textLimits), ...Object.keys(ranges), ...booleans,
    "avatarDataUrl", "email", "phoneVerified", "verifiedPhone"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new ProfileInputError();
  const defaults = createDefaultCabinetProfile({ name: "Пользователь", email: "" });
  const result = Object.fromEntries(Object.entries(defaults).filter(([key]) => !["email", "phoneVerified", "verifiedPhone"].includes(key))) as StoredCabinetProfile;
  for (const [key, limit] of Object.entries(textLimits)) {
    const field = key as keyof typeof textLimits;
    if (!Object.hasOwn(input, key)) continue;
    const text = input[key];
    const controls = field === "organizationDescription" ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (typeof text !== "string" || !text.isWellFormed() || controls.test(text) || text.trim().length > limit) throw new ProfileInputError();
    result[field] = text.trim();
  }
  result.name ||= defaults.name;
  for (const field of booleans) {
    if (!Object.hasOwn(input, field)) continue;
    if (typeof input[field] !== "boolean") throw new ProfileInputError();
    result[field] = input[field];
  }
  for (const field of Object.keys(ranges) as (keyof typeof ranges)[]) {
    if (!Object.hasOwn(input, field)) continue;
    const number = input[field], [min, max] = ranges[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) throw new ProfileInputError();
    result[field] = number;
  }
  for (const [value, sizes] of [[result.organizationInn, [10, 12]], [result.organizationOgrn, [13, 15]]] as const) {
    if (value && (!/^\d+$/.test(value) || !sizes.some(size => size === value.length))) throw new ProfileInputError();
  }
  if (Object.hasOwn(input, "avatarDataUrl")) {
    const avatar = input.avatarDataUrl;
    if (typeof avatar !== "string" || avatar.length > 409623) throw new ProfileInputError();
    if (avatar) {
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatar);
      if (!match) throw new ProfileInputError();
      const bytes = Buffer.from(match[2], "base64");
      const signature = match[1] === "png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : match[1] === "jpeg" ? bytes.subarray(0,3).equals(Buffer.from([255,216,255]))
        : bytes.subarray(0,4).toString("ascii") === "RIFF" && bytes.subarray(8,12).toString("ascii") === "WEBP";
      if (!signature || bytes.length > 300*1024 || bytes.toString("base64") !== match[2]) throw new ProfileInputError();
    }
    result.avatarDataUrl = avatar;
  }
  return result;
}

async function profileEmail(tx: PostgresQueries, userId: string): Promise<string> {
  const row = (await tx.query<{ email: string }>("select email from app.users where id=$1", [userId])).rows[0];
  if (!row) throw new Error("Profile identity unavailable");
  return row.email;
}
function view(profile: StoredCabinetProfile, email: string): CabinetProfile {
  return { ...profile, email, phoneVerified: false, verifiedPhone: "" };
}

export class PostgresProfileStore {
  constructor(private readonly db: Pick<PostgresDatabase, "transaction">) {
    if (typeof window !== "undefined") throw new Error("Profile storage is server-only");
  }
  async read(token: string, expectedOwnerId: string): Promise<{ exists: boolean; profile: CabinetProfile }> {
    return withAppSessionTransaction(this.db, token, async (tx, user) => {
      if (user.id !== expectedOwnerId) throw new ProfileOwnerChangedError();
      const email = await profileEmail(tx, user.id);
      const row = (await tx.query<{ profile: StoredCabinetProfile }>("select profile from app.cabinet_profiles where user_id=$1", [user.id])).rows[0];
      return { exists: Boolean(row), profile: row ? view(row.profile, email)
        : createDefaultCabinetProfile({ name: email.split("@")[0] || "Пользователь", email }) };
    });
  }
  async write(token: string, expectedOwnerId: string, profile: StoredCabinetProfile): Promise<{ profile: CabinetProfile }> {
    return withAppSessionTransaction(this.db, token, async (tx, user) => {
      if (user.id !== expectedOwnerId) throw new ProfileOwnerChangedError();
      const email = await profileEmail(tx, user.id);
      await tx.query(`insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)
        on conflict(user_id) do update set profile=excluded.profile,updated_at=clock_timestamp()`, [user.id, JSON.stringify(profile)]);
      return { profile: view(profile, email) };
    });
  }
}
