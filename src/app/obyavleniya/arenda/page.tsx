import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Аренда",
  description: "Объявления об аренде и бронировании на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/arenda",
  },
};

export default function Page() {
  redirect("/obyavleniya?kind=arenda");
}
