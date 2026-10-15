"use client";
import { useEffect } from "react";

export function useDraftLeaveGuard(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault();event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest("a");
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const next = new URL(link.href, window.location.href);
      if (!["http:", "https:"].includes(next.protocol) || (next.origin === window.location.origin && next.pathname === window.location.pathname && next.search === window.location.search)) return;
      if (!window.confirm("Есть несохранённые или неподтверждённые изменения. Покинуть редактор? Отправленный запрос при этом не отменяется.")) {
        event.preventDefault();event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload);document.removeEventListener("click", navigate, true); };
  }, [unsaved]);
}
