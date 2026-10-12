import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductionAuthPage } from "@/components/auth/ProductionAuthPage";
import type { ProductionAuthView } from "@/components/auth/ProductionAuthPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Аккаунт", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!["register", "confirm", "recover", "reset"].includes(action)) notFound();
  return <ProductionAuthPage mode={action as ProductionAuthView} />;
}
