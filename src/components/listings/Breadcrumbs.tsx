import Link from "next/link";

export function Breadcrumbs({ items, compact = false }: { items: { label: string; href?: string }[]; compact?: boolean }) {
  return (
    <nav className={`${compact ? "mb-2" : "mb-4"} flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm`} aria-label="Хлебные крошки">
      <Link href="/obyavleniya" className="hover:text-[#0875d1]">
        Объявления
      </Link>
      {items.map((item, index) => (
        <span key={`${item.href ?? item.label}-${index}`} className="flex items-center gap-2">
          <span>/</span>
          {item.href ? (
            <Link href={item.href} className="hover:text-[#0875d1]">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
