import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/LegalDocumentPage";

export const metadata: Metadata = { title: "Пользовательское соглашение", alternates: { canonical: "/legal/agreement" } };

export default function Page() {
  return <LegalDocumentPage documentKey="agreement" />;
}
