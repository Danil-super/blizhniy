import type { PostgresQueries } from "./postgres";
import type { Tariff } from "./types";

type TariffRow = {
  id: string;
  action: Tariff["action"];
  name: string;
  price: string;
  duration_days: number | null;
  active: boolean;
};
const tariffColumns = "id, action, name, price::text, duration_days, active";

function tariffFromRow(row: TariffRow): Tariff {
  // Preserve the UI's number contract, not a payment arithmetic representation.
  // SQL casts numeric(12,2) to text explicitly; malformed money must fail closed.
  if (typeof row.price !== "string" || !/^\d{1,10}\.\d{2}$/.test(row.price)) {
    throw new Error("Invalid tariff price");
  }
  return { id: row.id, action: row.action, name: row.name, price: Number(row.price),
    durationDays: row.duration_days, active: row.active };
}

export class TariffInputError extends Error {
  constructor() { super("Invalid tariff input"); this.name = "TariffInputError"; }
}

/** Server-side reads only. Does not synthesize IDs/prices from static seed data. */
export class PostgresTariffRepository {
  private readonly db: PostgresQueries;

  constructor(db: PostgresQueries) {
    if (typeof window !== "undefined") throw new Error("Tariffs are server-only");
    this.db = db;
  }

  async getStoredTariffs(): Promise<Tariff[]> {
    const { rows } = await this.db.query<TariffRow>(`select ${tariffColumns} from app.tariffs order by app.tariffs.price, id`);
    return rows.map(tariffFromRow);
  }

  async getPublicTariffs(): Promise<Tariff[]> {
    // Preserve the former public contract: active is data, not a list filter.
    return this.getStoredTariffs();
  }

  getStoredTariffById(id: string): Promise<Tariff | undefined> { return this.findById(id, false); }
  getActiveStoredTariffById(id: string): Promise<Tariff | undefined> { return this.findById(id, true); }

  private async findById(id: string, activeOnly: boolean): Promise<Tariff | undefined> {
    if (typeof id !== "string" || id.length > 100 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      throw new TariffInputError();
    }
    const { rows } = await this.db.query<TariffRow>(`select ${tariffColumns} from app.tariffs
      where id=$1 and (not $2::boolean or active)`, [id, activeOnly]);
    return rows[0] ? tariffFromRow(rows[0]) : undefined;
  }
}
