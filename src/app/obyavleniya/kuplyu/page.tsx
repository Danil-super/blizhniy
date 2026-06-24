import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Куплю",
  description: "Запросы покупателей на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/kuplyu",
  },
};

export default function Page() {
  redirect("/obyavleniya?kind=kuplyu");
}
