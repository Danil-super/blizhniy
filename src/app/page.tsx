import type { Metadata } from "next";
import { publicationOpenGraph } from "@/lib/publication-open-graph";
import { CategoryGrid } from "@/components/CategoryGrid";
import { HomeHero } from "@/components/HomeHero";
import { HomeIntro } from "@/components/HomeIntro";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: publicationOpenGraph(
    "БЛИЖНИЙ — объявления, работа и специалисты Краснодарского края",
    "Объявления, вакансии, заказы и анкеты специалистов Краснодарского края.",
    "/",
  ),
};

export default async function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <HomeHero />
        <HomeIntro />
        <CategoryGrid />
      </main>
    </>
  );
}
