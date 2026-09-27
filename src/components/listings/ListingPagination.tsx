import Link from "next/link";

export function ListingPagination({ baseHref, hasMore, page, label = "Страницы объявлений" }: { baseHref: string; hasMore: boolean; page: number; label?: string }) {
  if (page === 1 && !hasMore) {
    return null;
  }

  const pageHref = (number: number) => (number === 1 ? baseHref : `${baseHref}?page=${number}`);

  return (
    <nav aria-label={label} className="mt-6 flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#0875d1]" href={pageHref(page - 1)}>
          Назад
        </Link>
      ) : null}
      <span className="text-sm font-bold text-slate-700">Страница {page}</span>
      {hasMore ? (
        <Link className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#0875d1]" href={pageHref(page + 1)}>
          Далее
        </Link>
      ) : null}
    </nav>
  );
}
