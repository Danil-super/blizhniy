import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FairHomePage } from "@/components/FairPages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ярмарка мастеров", alternates: { canonical: "/yarmarka-masterov" } };

export default function Page() {
  return (
    <>
      <SiteHeader />
      <FairHomePage />
    </>
  );
}
