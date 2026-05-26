import { CategoryGrid } from "@/components/CategoryGrid";
import { HomeListings } from "@/components/HomeListings";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <CategoryGrid />
        <HomeListings />
      </main>
    </>
  );
}
