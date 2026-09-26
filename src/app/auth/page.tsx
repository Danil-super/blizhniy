import type { Metadata } from "next";
import { AuthPage } from "@/components/MvpDashboard";

export const metadata: Metadata = { title: "Вход", robots: { index: false, follow: false } };

export default function Page() {
  return <AuthPage />;
}
