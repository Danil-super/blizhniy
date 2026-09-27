import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/LegalDocumentPage";

export const metadata: Metadata = { title: "Оферта", alternates: { canonical: "/legal/offer" } };

export default function Page() {
  return <LegalDocumentPage documentKey="offer" />;
}
