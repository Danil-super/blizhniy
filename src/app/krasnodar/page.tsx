import type { Metadata } from "next";
import { CategoryGrid } from "@/components/CategoryGrid";
import { HomeListings } from "@/components/HomeListings";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Краснодар",
  description: "Региональная витрина объявлений, работы и специалистов Краснодара на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy",
  },
};

export default function KrasnodarPage() {
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
