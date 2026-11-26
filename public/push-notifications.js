/* global self */

function deliveryId(message) {
  const raw = message?.text();
  if (!raw || raw.length > 96) return null;
  try {
    const value = JSON.parse(raw);
    if (value && Object.keys(value).length === 1 &&
        typeof value.id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.id)) return value.id;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return null;
}

async function mayDisplay(id) {
  try {
    const response = await fetch("/api/account/push", {
      method: "POST",
      mode: "same-origin",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" },
      body: JSON.stringify({ action: "authorize", id }),
      signal: AbortSignal.timeout(5000),
    });
    return response.status === 204;
  } catch {
    return false;
  }
}

self.addEventListener("push", (event) => {
  const id = deliveryId(event.data);
  if (!id || self.Notification.permission !== "granted") return;
  event.waitUntil((async () => {
    if (!await mayDisplay(id) || self.Notification.permission !== "granted") return;
    await self.registration.showNotification("БЛИЖНИЙ", {
      body: "В личном кабинете есть новое уведомление.",
      tag: "blizhniy-" + id,
      data: { id },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  const { id } = event.notification.data ?? {};
  event.notification.close();
  if (typeof id !== "string") return;
  event.waitUntil((async () => {
    if (!await mayDisplay(id)) return;
    const cabinet = new URL("/cabinet", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(window => window.url === cabinet);
    if (existing) await existing.focus();
    else await self.clients.openWindow(cabinet);
  })());
});
