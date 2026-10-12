import type { Metadata } from "next";
import { AuthPage } from "@/components/MvpDashboard";
import { ProductionAuthPage } from "@/components/auth/ProductionAuthPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function Page() {
  if (process.env.BLIZHNIY_AUTH_MODE === "postgres") return <ProductionAuthPage mode="login" />;
  return <AuthPage />;
}
