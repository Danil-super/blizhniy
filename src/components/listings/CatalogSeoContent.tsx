import Link from "next/link";
import { getPublicSiteUrl } from "@/lib/site-url";

type RelatedSection = {
  href: string;
  label: string;
};

type CatalogSeoContentProps = {
  categoryName: string;
  categoryPath: string;
  description: string;
  relatedSections?: RelatedSection[];
  sectionName?: string;
  sectionPath?: string;
};

function absoluteUrl(path: string) {
  return `${getPublicSiteUrl()}${path}`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function CatalogSeoContent({
  categoryName,
  categoryPath,
  description,
  relatedSections = [],
  sectionName,
  sectionPath,
}: CatalogSeoContentProps) {
  const currentName = sectionName ?? categoryName;
  const currentPath = sectionPath ?? categoryPath;
  const breadcrumbItems = [
    { "@type": "ListItem", position: 1, name: "Каталог", item: absoluteUrl("/katalog") },
    { "@type": "ListItem", position: 2, name: categoryName, item: absoluteUrl(categoryPath) },
    ...(sectionName && sectionPath ? [{ "@type": "ListItem", position: 3, name: sectionName, item: absoluteUrl(sectionPath) }] : []),
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: breadcrumbItems },
      {
        "@type": "CollectionPage",
        name: `${currentName} — объявления в Краснодарском крае`,
        description,
        url: absoluteUrl(currentPath),
        isPartOf: { "@type": "WebSite", name: "БЛИЖНИЙ", url: getPublicSiteUrl() },
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJson(structuredData) }} />
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label={`О разделе ${currentName}`}>
        <h2 className="text-lg font-bold text-[#060b27]">Объявления: {currentName}</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{description}</p>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
          Сравнивайте предложения, уточняйте детали у продавца и размещайте собственное объявление — сервис работает для жителей Краснодара и Краснодарского края.
        </p>
        {relatedSections.length ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-bold text-[#060b27]">Смотрите также</h3>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {relatedSections.map((section) => (
                <li key={section.href}>
                  <Link href={section.href} className="font-semibold text-[#0875d1] hover:underline">{section.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </>
  );
}
