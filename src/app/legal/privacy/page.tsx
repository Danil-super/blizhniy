import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
  description: "Какие персональные данные обрабатывает БЛИЖНИЙ, для каких целей и как обратиться по вопросам их обработки.",
  alternates: { canonical: "/legal/privacy" },
};

export default function Page() {
  return <LegalDocumentPage documentKey="privacy" />;
}
