export function clearLegacySiteNotificationStorage(storage: Pick<Storage, "length" | "key" | "removeItem">) {
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith("blizhniy-site-notifications:")) storage.removeItem(key);
    }
    return true;
  } catch {
    // Disabled storage must not prevent server-backed notifications from working.
    return false;
  }
}
