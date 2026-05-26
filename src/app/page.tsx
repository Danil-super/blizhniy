import { CategoryGrid } from "@/components/CategoryGrid";
import { HomeHero } from "@/components/HomeHero";
import { HomeListings } from "@/components/HomeListings";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <HomeHero />
        <CategoryGrid />
        <HomeListings />
      </main>
    </>
  );
}
