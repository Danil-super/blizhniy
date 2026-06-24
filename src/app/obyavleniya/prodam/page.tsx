import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Продам",
  description: "Объявления о продаже товаров на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/prodam",
  },
};

export default function Page() {
  redirect("/obyavleniya?kind=prodam");
}
