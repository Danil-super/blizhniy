import { withAdminTransaction } from "./admin-authorization";
import type { PostgresDatabase } from "./postgres";

export class TariffEditInputError extends Error {
  constructor() { super("Invalid tariff edit"); this.name = "TariffEditInputError"; }
}

function edit(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TariffEditInputError();
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (!Object.hasOwn(value, "id") || typeof value.id !== "string" || value.id.length > 100 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value.id) || keys.length < 2 ||
      keys.some(key => !["id", "name", "price", "durationDays", "active"].includes(key))) throw new TariffEditInputError();
  let name: string | null = null;
  let price: string | null = null;
  let durationDays: number | null = null;
  let active: boolean | null = null;
  if (Object.hasOwn(value, "name")) {
    if (typeof value.name !== "string" || !value.name.isWellFormed() || /[\x00-\x1f\x7f]/.test(value.name)) throw new TariffEditInputError();
    name = value.name.trim();
    if (!name || name.length > 200) throw new TariffEditInputError();
  }
  if (Object.hasOwn(value, "price")) {
    if (typeof value.price !== "number" || !Number.isFinite(value.price) || value.price < 0 || value.price > 9999999999.99 ||
        !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value.price))) throw new TariffEditInputError();
    // UI number in, exact decimal parameter out; never round fractional kopeks.
    price = value.price.toFixed(2);
  }
  const hasDuration = Object.hasOwn(value, "durationDays");
  if (hasDuration) {
    if (value.durationDays !== null && (typeof value.durationDays !== "number" ||
        !Number.isSafeInteger(value.durationDays) || value.durationDays < 1 || value.durationDays > 3650)) throw new TariffEditInputError();
    durationDays = value.durationDays as number | null;
  }
  if (Object.hasOwn(value, "active")) {
    if (typeof value.active !== "boolean") throw new TariffEditInputError();
    active = value.active;
  }
  return { id: value.id, name, price, durationDays, hasDuration, active };
}

/** Patches existing tariffs, never their action/ID and never restores seed prices. */
export class TariffAdministration {
  constructor(private readonly db: Pick<PostgresDatabase, "transaction">) {
    if (typeof window !== "undefined") throw new Error("Tariff administration is server-only");
  }

  async updateTariff(token: string, input: unknown): Promise<boolean> {
    const value = edit(input);
    return withAdminTransaction(this.db, token, async tx => {
      const result = await tx.query(`update app.tariffs
        set name=coalesce($2::text,name),price=coalesce($3::numeric,price),active=coalesce($4::boolean,active),
        duration_days=case when $5::boolean then $6::integer else duration_days end where id=$1`,
      [value.id, value.name, value.price, value.active, value.hasDuration, value.durationDays]);
      return result.rowCount === 1;
    });
  }
}
