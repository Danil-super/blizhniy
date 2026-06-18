import { SiteHeader } from "@/components/SiteHeader";
import { legalDocuments, type LegalDocumentKey } from "@/lib/legal-documents";

function isSectionHeading(value: string) {
  return /^\d+\.\s+\S/.test(value);
}

export function LegalDocumentPage({ documentKey }: { documentKey: LegalDocumentKey }) {
  const document = legalDocuments[documentKey];

  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-10">
        <article className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Юридические документы</p>
          <h1 className="mt-3 text-2xl font-black leading-tight text-[#060b27] sm:text-4xl">{document.title}</h1>
          {document.edition ? <p className="mt-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-[#0875d1]">{document.edition}</p> : null}
          <div className="mt-7 space-y-4 text-base leading-7 text-slate-700">
            {document.body.map((paragraph, index) =>
              isSectionHeading(paragraph) ? (
                <h2 key={`${paragraph}-${index}`} className="pt-4 text-xl font-black leading-snug text-[#060b27]">
                  {paragraph}
                </h2>
              ) : (
                <p key={`${paragraph}-${index}`} className="min-w-0 [overflow-wrap:anywhere]">
                  {paragraph}
                </p>
              ),
            )}
          </div>
        </article>
      </main>
    </>
  );
}
