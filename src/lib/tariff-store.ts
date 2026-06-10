import { tariffs as baseTariffs } from "@/lib/data";
import type { Tariff } from "@/lib/types";

type TariffPatch = {
  name?: string;
  price?: number;
  durationDays?: number | null;
  active?: boolean;
};

declare global {
  var __blizhniyTariffPatches: Record<string, TariffPatch> | undefined;
}

function getPatchStore() {
  globalThis.__blizhniyTariffPatches ??= {};
  return globalThis.__blizhniyTariffPatches;
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
