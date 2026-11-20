import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Пользовательское соглашение",
  description: "Правила использования БЛИЖНИЙ, размещения материалов и взаимодействия пользователей на площадке.",
  alternates: { canonical: "/legal/agreement" },
};

export default function Page() {
  return <LegalDocumentPage documentKey="agreement" />;
}
