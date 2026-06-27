import { CategoryGrid } from "@/components/CategoryGrid";
import { HomeHero } from "@/components/HomeHero";
import { HomeIntro } from "@/components/HomeIntro";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

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
