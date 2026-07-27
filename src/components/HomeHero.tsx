import { getActiveAdMarqueeMessages } from "@/lib/ad-marquee-store";

export async function HomeHero() {
  const messages = await getActiveAdMarqueeMessages();

  return (
    <section className="page-container py-1 sm:py-3" aria-label="Рекламная строка">
      <div className="flex min-h-8 items-center overflow-hidden rounded-xl border border-blue-100 bg-white py-1 shadow-sm sm:min-h-12 sm:rounded-2xl sm:py-2">
        <div className="min-w-0 flex-1 overflow-hidden" aria-live="off">
          <div className="marquee-track flex w-max items-center gap-8 text-xs font-semibold text-slate-700 sm:text-sm">
            {messages.map((message, index) => (
              <span key={`${index}-${message}`} className="flex items-center gap-8 whitespace-nowrap">
                <span>{message}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
