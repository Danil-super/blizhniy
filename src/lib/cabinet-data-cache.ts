"use client";

const cabinetDataVersionStorageKey = "blizhniy-cabinet-data-version";

export const cabinetDataUpdatedEvent = "blizhniy-cabinet-data-updated";

export function readCabinetDataVersion() {
  if (typeof window === "undefined") {
    return 0;
  }

  const version = Number(window.localStorage.getItem(cabinetDataVersionStorageKey));

  return Number.isFinite(version) ? version : 0;
}

export function markCabinetDataChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(cabinetDataVersionStorageKey, String(Date.now()));
  window.dispatchEvent(new Event(cabinetDataUpdatedEvent));
}
