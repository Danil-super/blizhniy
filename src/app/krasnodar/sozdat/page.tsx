import type { Metadata } from "next";
import { PublicationChoicePage } from "@/components/PublicationChoicePage";

export const metadata: Metadata = {
  title: "Разместить публикацию в Краснодаре",
  description: "Выбор типа публикации на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/sozdat",
  },
};

export default function Page() {
  return <PublicationChoicePage />;
}
