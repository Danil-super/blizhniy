"use client";

import { useEffect, useId, useRef, useState } from "react";

const script = "/push-notifications.js";
const scope = "/cabinet";
const buttonClass = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-60";
type View = {
  status: "active" | "ready" | "preference_off";
  publicKey: string;
  supported: boolean;
  permission: NotificationPermission;
  registration?: ServiceWorkerRegistration;
  subscription: PushSubscription | null;
};

async function request(owner: string, action: "status" | "subscribe" | "unsubscribe", signal: AbortSignal, subscription?: PushSubscription) {
  signal.throwIfAborted();
  const data = subscription?.toJSON();
  return await fetch("/api/account/push", {
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json", "X-Blizhniy-Request": "1" },
    body: JSON.stringify({ action, expectedOwnerId: owner,
      ...(data && { subscription: { endpoint: data.endpoint, keys: data.keys, expirationTime: subscription?.expirationTime ?? null } }) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
}

async function getWorker(prepare: boolean, signal: AbortSignal) {
  const expectedScope = new URL(scope, location.origin).href;
  const expectedScript = new URL(script, location.origin).href;
  let registration = await navigator.serviceWorker.getRegistration(scope);
  if (registration?.scope !== expectedScope) registration = undefined;
  if (!registration && !prepare) return;
  signal.throwIfAborted();
  registration ??= await navigator.serviceWorker.register(script, { scope, updateViaCache: "none" });
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (worker?.scriptURL !== expectedScript) throw new Error("Push worker unavailable");
  if (prepare && worker.state !== "activated") {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
    deadline.throwIfAborted();
    registration = await new Promise<ServiceWorkerRegistration>((resolve, reject) => {
      const abort = () => reject(deadline.reason);
      deadline.addEventListener("abort", abort, { once: true });
      void navigator.serviceWorker.ready.then(resolve, reject).finally(() => deadline.removeEventListener("abort", abort));
    });
    if (registration.scope !== expectedScope || registration.active?.scriptURL !== expectedScript) {
      throw new Error("Push worker unavailable");
    }
  }
  return registration;
}

function matchesKey(subscription: PushSubscription, key: string) {
  const value = subscription.options.applicationServerKey;
  return value !== null && btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") === key;
}

export function BrowserPushSettings({ owner, preference }: { owner: string; preference: boolean }) {
  const hintId = useId();
  const [view, setView] = useState<View | "loading" | "unavailable" | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (!document.querySelector('meta[name="blizhniy-push"][content="enabled"]')) return;
    const controller = new AbortController();
    const { signal } = controller;
    lifetime.current = controller;
    pending.current = false;
    setBusy(false);
    setView(previous => previous ?? "loading");

    async function load() {
      const response = await request(owner, "status", signal);
      if (response.status !== 200) throw new Error("Push settings unavailable");
      const { status, publicKey } = await response.json();
      if ((status !== "ready" && status !== "active" && status !== "preference_off") ||
          typeof publicKey !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(publicKey)) throw new Error("Push settings unavailable");
      const supported = isSecureContext && "serviceWorker" in navigator &&
        typeof Notification !== "undefined" && typeof PushManager !== "undefined";
      const permission = supported ? Notification.permission : "denied";
      const registration = supported ? await getWorker(status !== "preference_off" && permission !== "denied", signal) : undefined;
      const subscription = await registration?.pushManager.getSubscription() ?? null;
      if (!signal.aborted) setView({ status, publicKey, supported, permission, registration, subscription });
    }

    void load().catch(() => { if (!signal.aborted) setView("unavailable"); });
    const refresh = () => { if (!pending.current) setRevision(value => value + 1); };
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [owner, preference, revision]);

  async function change(enable: boolean) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || pending.current || !view || typeof view === "string") return;
    if (enable && (!view.registration || view.status === "preference_off" || Notification.permission === "denied")) return;
    pending.current = true;
    setBusy(true);
    setMessage("");

    try {
      if (enable && view.registration) {
        // The browser prompt must start inside the click, before any asynchronous request.
        const subscription = await view.registration.pushManager.subscribe({ applicationServerKey: view.publicKey, userVisibleOnly: true });
        const result = await request(owner, "subscribe", signal, subscription);
        if (result.status !== 204) throw new Error("Push subscription unavailable");
        if (!signal.aborted) setMessage("Подписка подтверждена.");
      } else {
        const result = await request(owner, "unsubscribe", signal);
        if (result.status !== 204) throw new Error("Push unsubscribe unavailable");
        signal.throwIfAborted();
        const native = await view.registration?.pushManager.getSubscription();
        signal.throwIfAborted();
        if (native && !await native.unsubscribe()) {
          if (!signal.aborted) setMessage("В аккаунте Push отключён. Браузер не подтвердил удаление подписки.");
        } else if (!signal.aborted) setMessage("Этот браузер отключён.");
      }
    } catch {
      if (!signal.aborted) setMessage(enable && Notification.permission !== "granted"
        ? "Браузер не предоставил разрешение на уведомления."
        : "Результат действия не подтверждён. Проверьте состояние браузера и повторите попытку.");
    } finally {
      if (!signal.aborted) {
        setView("loading");
        setRevision(value => value + 1);
      }
    }
  }

  if (!view) return null;

  const state = typeof view === "string" ? null : view;
  const keyChanged = !!state?.subscription && !matchesKey(state.subscription, state.publicKey);
  const needsReset = state?.status === "ready" && !!state.subscription;
  const unlink = !!state && (state.status === "active" || state.subscription !== null);
  const alreadyLinked = state?.status === "active" && state.permission === "granted" && !!state.subscription && !keyChanged;
  const canConnect = !!state?.registration && state.status !== "preference_off" && state.permission !== "denied" && !keyChanged && !needsReset && !alreadyLinked;
  const hint = view === "loading" ? "Проверяем состояние браузера…" :
    !state ? "Не удалось проверить состояние Push." :
    state.status === "preference_off" ? "Чтобы подключить браузер, включите Push и сохраните настройки." :
    !state.supported ? "Push-уведомления недоступны в этом браузере." :
    state.permission === "denied" ? "Уведомления заблокированы браузером. Разрешите их в настройках сайта." :
    keyChanged ? "Ключ Push изменился. Отключите браузер и подключите снова." :
    needsReset ? "В браузере осталась прежняя подписка. Отключите её перед повторным подключением." :
    alreadyLinked ? "Этот браузер подключён." :
    state.permission === "default" ? "Подключите этот браузер и разрешите уведомления по запросу." :
    "Подключите этот браузер для получения уведомлений.";

  return (
    <div role="group" aria-label="Push в этом браузере" className="mt-3 border-t border-slate-200 pt-3">
      <p id={hintId} className="text-sm leading-5 text-slate-700">{hint}</p>
      {(canConnect || unlink || view === "unavailable") && (
        <div className="mt-2 flex flex-wrap gap-2">
          {canConnect && <button type="button" className={buttonClass} aria-describedby={hintId} disabled={busy} onClick={() => void change(true)}>Подключить браузер</button>}
          {unlink && <button type="button" className={buttonClass} aria-describedby={hintId} disabled={busy} onClick={() => void change(false)}>Отключить браузер</button>}
          {view === "unavailable" && <button type="button" className={buttonClass} onClick={() => setRevision(value => value + 1)}>Проверить снова</button>}
        </div>
      )}
      <p role="status" className={busy || message ? "mt-2 text-sm leading-5 text-slate-700" : "sr-only"}>
        {busy ? "Обновляем подписку…" : message}
      </p>
    </div>
  );
}
