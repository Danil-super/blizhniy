import { tariffs as baseTariffs } from "@/lib/data";
import { isSupabaseRestConfigured, supabaseRest } from "@/lib/supabase-rest";
import type { Tariff } from "@/lib/types";

type TariffPatch = {
  name?: string;
  price?: number;
  durationDays?: number | null;
  active?: boolean;
};

type TariffRow = {
  action: Tariff["action"];
  active: boolean;
  duration_days: number | null;
  id: string;
  name: string;
  price: number | string;
};

declare global {
  var __blizhniyTariffPatches: Record<string, TariffPatch> | undefined;
}

function getPatchStore() {
  globalThis.__blizhniyTariffPatches ??= {};
  return globalThis.__blizhniyTariffPatches;
}

function tariffFromRow(row: TariffRow): Tariff {
  const fallback = baseTariffs.find((tariff) => tariff.action === row.action);

  return {
    id: fallback?.id ?? row.action.replaceAll("_", "-"),
    name: row.name,
    action: row.action,
    price: Number(row.price),
    durationDays: row.duration_days,
    active: row.active,
  };
}

function rowPatchFromTariffPatch(patch: TariffPatch) {
  return {
    ...(typeof patch.name === "string" ? { name: patch.name } : {}),
    ...(typeof patch.price === "number" ? { price: patch.price } : {}),
    ...(patch.durationDays !== undefined ? { duration_days: patch.durationDays } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    updated_at: new Date().toISOString(),
  };
}

export function getTariffs() {
  const patches = getPatchStore();

  return baseTariffs.map((tariff) => {
    const patch = patches[tariff.id];

    if (!patch) {
      return { ...tariff };
    }

    return {
      ...tariff,
      ...(typeof patch.name === "string" ? { name: patch.name } : {}),
      ...(typeof patch.price === "number" ? { price: patch.price } : {}),
      ...(patch.durationDays !== undefined ? { durationDays: patch.durationDays } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    };
  });
}

export async function getStoredTariffs() {
  if (!isSupabaseRestConfigured()) {
    return getTariffs();
  }

  const rows = await supabaseRest<TariffRow[]>("/rest/v1/tariffs?select=id,name,action,price,duration_days,active&order=price.asc");
  const storedByAction = new Map(rows.map((row) => [row.action, tariffFromRow(row)]));
  const merged = baseTariffs.map((tariff) => storedByAction.get(tariff.action) ?? { ...tariff });
  const extra = rows.map(tariffFromRow).filter((tariff) => !baseTariffs.some((baseTariff) => baseTariff.action === tariff.action));

  return [...merged, ...extra];
}

export async function getStoredTariffById(tariffId: string) {
  return (await getStoredTariffs()).find((item) => item.id === tariffId);
}

export async function getActiveStoredTariffById(tariffId: string) {
  return (await getStoredTariffs()).find((item) => item.id === tariffId && item.active);
}

export async function updateTariff(tariffId: string, patch: TariffPatch) {
  const tariff = baseTariffs.find((item) => item.id === tariffId);

  if (!tariff) {
    throw new Error("Tariff not found");
  }

  if (!isSupabaseRestConfigured()) {
    updateTariffPatch(tariffId, patch);
    return;
  }

  await supabaseRest(`/rest/v1/tariffs?action=eq.${encodeURIComponent(tariff.action)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: rowPatchFromTariffPatch(patch),
  });
}

export async function resetStoredTariffs() {
  if (!isSupabaseRestConfigured()) {
    resetTariffPatches();
    return;
  }

  await Promise.all(
    baseTariffs.map((tariff) =>
      supabaseRest(`/rest/v1/tariffs?action=eq.${encodeURIComponent(tariff.action)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          active: tariff.active,
          duration_days: tariff.durationDays,
          name: tariff.name,
          price: tariff.price,
          updated_at: new Date().toISOString(),
        },
      }),
    ),
  );
}

export function updateTariffPatch(tariffId: string, patch: TariffPatch) {
  const tariff = baseTariffs.find((item) => item.id === tariffId);

  if (!tariff) {
    throw new Error("Tariff not found");
  }

  const store = getPatchStore();
  const current = store[tariffId] ?? {};
  store[tariffId] = { ...current, ...patch };
}

export function resetTariffPatches() {
  globalThis.__blizhniyTariffPatches = {};
}

export function getTariffById(tariffId: string) {
  return getTariffs().find((item) => item.id === tariffId);
}

export function getActiveTariffById(tariffId: string) {
  return getTariffs().find((item) => item.id === tariffId && item.active);
}

export function serializeTariffForForm(tariff: Tariff) {
  return {
    id: tariff.id,
    name: tariff.name,
    action: tariff.action,
    price: tariff.price,
    durationDays: tariff.durationDays,
    active: tariff.active,
  };
}
