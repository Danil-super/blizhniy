import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/LegalDocumentPage";

export const metadata: Metadata = { title: "Политика конфиденциальности", alternates: { canonical: "/legal/privacy" } };

export default function Page() {
  return <LegalDocumentPage documentKey="privacy" />;
}
