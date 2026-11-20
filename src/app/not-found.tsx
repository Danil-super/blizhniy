import Link from "next/link";

export const metadata = { title: "Страница не найдена" };

export default function NotFound() {
  return (
    <main className="page-container py-10">
      <section className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-5 sm:p-8">
        <h1 className="text-2xl font-bold text-[#060b27]">Страница не найдена</h1>
        <p className="mt-3 leading-7 text-slate-600">Проверьте адрес или перейдите на главную страницу.</p>
        <Link className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 font-semibold text-blue-800" href="/">
          На главную
        </Link>
      </section>
    </main>
  );
}
