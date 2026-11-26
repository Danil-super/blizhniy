"use client";
import { useEffect } from "react";

type HistoryNavigation = Event & {
  navigationType: string;
  userInitiated: boolean;
  destination: { url: string; sameDocument: boolean };
};

export function guardDraftLeave() {
  const confirmLeave = () => window.confirm("Есть несохранённые или неподтверждённые изменения. Покинуть редактор? Отправленный запрос при этом не отменяется.");
  const leavesRoute = (next: URL) => ["http:", "https:"].includes(next.protocol) &&
    (next.origin !== window.location.origin || next.pathname !== window.location.pathname || next.search !== window.location.search);
  const unload = (event: BeforeUnloadEvent) => { event.preventDefault();event.returnValue = ""; };
  const navigate = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest("a");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    if (leavesRoute(new URL(link.href, window.location.href)) && !confirmLeave()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const browserNavigation = (window as Window & { navigation?: EventTarget }).navigation;
  const traverse = (event: Event) => {
    const { navigationType, userInitiated, destination } = event as HistoryNavigation;
    // Document exits use beforeunload and the site's Back link uses click.
    if (!event.defaultPrevented && event.cancelable && navigationType === "traverse" && userInitiated &&
        destination.sameDocument && leavesRoute(new URL(destination.url)) && !confirmLeave()) event.preventDefault();
  };
  window.addEventListener("beforeunload", unload);
  document.addEventListener("click", navigate, true);
  browserNavigation?.addEventListener("navigate", traverse);
  return () => {
    window.removeEventListener("beforeunload", unload);
    document.removeEventListener("click", navigate, true);
    browserNavigation?.removeEventListener("navigate", traverse);
  };
}

export function useDraftLeaveGuard(unsaved: boolean) {
  useEffect(() => unsaved ? guardDraftLeave() : undefined, [unsaved]);
}
