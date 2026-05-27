"use client";

import { useEffect, useState } from "react";
import { Megaphone, RotateCcw, Save } from "lucide-react";
import { adMarqueeStorageKey, defaultAdMarqueeMessages } from "@/lib/ad-marquee";

function readSavedText() {
  if (typeof window === "undefined") {
    return defaultAdMarqueeMessages.join("\n");
  }

  try {
    const saved = window.localStorage.getItem(adMarqueeStorageKey);
    const parsed = saved ? (JSON.parse(saved) as unknown) : null;

    if (Array.isArray(parsed)) {
      const messages = parsed.map((item) => String(item).trim()).filter(Boolean);
      return messages.length ? messages.join("\n") : defaultAdMarqueeMessages.join("\n");
    }
  } catch {
    return defaultAdMarqueeMessages.join("\n");
  }

  return defaultAdMarqueeMessages.join("\n");
}

export function AdMarqueeAdminPanel() {
  const [text, setText] = useState(defaultAdMarqueeMessages.join("\n"));
  const [message, setMessage] = useState("Тексты отображаются в рекламной строке на главной.");

  useEffect(() => {
    setText(readSavedText());
  }, []);

  function saveMessages() {
    const messages = text.split("\n").map((item) => item.trim()).filter(Boolean);
    window.localStorage.setItem(adMarqueeStorageKey, JSON.stringify(messages.length ? messages : defaultAdMarqueeMessages));
    window.dispatchEvent(new Event("blizhniy-ad-marquee-updated"));
    setMessage("Сохранено для демонстрации в этом браузере.");
  }

  function resetMessages() {
    window.localStorage.removeItem(adMarqueeStorageKey);
    setText(defaultAdMarqueeMessages.join("\n"));
    window.dispatchEvent(new Event("blizhniy-ad-marquee-updated"));
    setMessage("Вернули стандартные тексты бегущей строки.");
  }

  return (
    <section className="rounded-xl border border-blue-100 bg-white p-3 shadow-card sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
          <Megaphone className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-black text-[#060b27] sm:text-2xl">Бегущая строка рекламы</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">{message}</p>
        </div>
      </div>

      <label className="mt-4 block">
        <span className="text-xs font-bold uppercase text-slate-500">Тексты, каждый с новой строки</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="mt-2 min-h-32 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-300 focus:bg-white"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" onClick={saveMessages} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0875d1] px-4 text-xs font-black text-white transition hover:bg-[#0664b3] sm:text-sm">
          <Save className="h-4 w-4" />
          Сохранить
        </button>
        <button type="button" onClick={resetMessages} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] sm:text-sm">
          <RotateCcw className="h-4 w-4" />
          Сбросить
        </button>
      </div>
    </section>
  );
}
