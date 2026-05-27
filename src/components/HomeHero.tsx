"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { adMarqueeStorageKey, defaultAdMarqueeMessages } from "@/lib/ad-marquee";

function readAdMessages() {
  if (typeof window === "undefined") {
    return defaultAdMarqueeMessages;
  }

  try {
    const saved = window.localStorage.getItem(adMarqueeStorageKey);
    const parsed = saved ? (JSON.parse(saved) as unknown) : null;

    if (Array.isArray(parsed)) {
      const messages = parsed.map((item) => String(item).trim()).filter(Boolean);
      return messages.length ? messages : defaultAdMarqueeMessages;
    }
  } catch {
    return defaultAdMarqueeMessages;
  }

  return defaultAdMarqueeMessages;
}

export function HomeHero() {
  const [messages, setMessages] = useState(defaultAdMarqueeMessages);

  useEffect(() => {
    const syncMessages = () => setMessages(readAdMessages());

    syncMessages();
    window.addEventListener("storage", syncMessages);
    window.addEventListener("blizhniy-ad-marquee-updated", syncMessages);

    return () => {
      window.removeEventListener("storage", syncMessages);
      window.removeEventListener("blizhniy-ad-marquee-updated", syncMessages);
    };
  }, []);

  return (
    <section className="page-container py-2 sm:py-3" aria-label="Рекламная строка">
      <div className="flex min-h-12 items-center gap-2 overflow-hidden rounded-2xl border border-blue-100 bg-white px-2.5 py-2 shadow-sm sm:px-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-blue-50 px-3 text-xs font-black uppercase text-[#0875d1] ring-1 ring-blue-100">
            <Megaphone className="h-3.5 w-3.5" />
            Реклама
          </span>
          <span className="hidden h-8 items-center rounded-full bg-emerald-50 px-3 text-xs font-black text-[#0a8f32] ring-1 ring-emerald-100 sm:inline-flex">
            Краснодарский край
          </span>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden" aria-live="off">
          <div className="marquee-track flex w-max items-center gap-8 text-sm font-semibold text-slate-700">
            {[0, 1].map((setIndex) => (
              <div key={setIndex} className="flex items-center gap-8" aria-hidden={setIndex === 1}>
                {messages.map((message, index) => (
                  <span key={`${setIndex}-${index}-${message}`} className="flex items-center gap-8 whitespace-nowrap">
                    <span>{message}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <Link href="/tarify" className="hidden h-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1] lg:inline-flex">
          Разместить рекламу
        </Link>
      </div>
    </section>
  );
}
