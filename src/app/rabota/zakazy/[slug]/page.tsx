import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { SiteHeader } from "@/components/SiteHeader";
import { listWorkRequests } from "@/lib/mock-store";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const request = listWorkRequests().find((item) => item.id === slug);

  if (!request || request.status !== "published") {
    notFound();
  }

  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <BackLink fallbackHref="/rabota" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#0875d1]">
          Назад
        </BackLink>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-7">
          <p className="text-sm font-semibold text-slate-500">{request.author}</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">{request.title}</h1>
          <p className="mt-3 text-xl font-black text-[#060b27] sm:text-2xl">{request.budget}</p>
          <p className="mt-3 text-slate-600">{[request.city, request.district].filter(Boolean).join(", ")}</p>
          <section className="mt-6 text-sm leading-6 text-slate-700 sm:text-base sm:leading-7">
            <h2 className="text-xl font-black text-[#060b27] sm:text-2xl">Описание</h2>
            <p className="mt-2">{request.description}</p>
          </section>
        </article>
      </main>
    </>
  );
}
