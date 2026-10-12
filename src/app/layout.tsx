import type { Metadata } from "next";
import { connection } from "next/server";
import { AccountAuthProvider } from "@/components/auth/AccountAuthProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { BookingLegacyStorageCleanup } from "@/components/BookingLegacyStorageCleanup";
import { getPublicSiteUrl } from "@/lib/site-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getPublicSiteUrl()),
  title: {
    default: "БЛИЖНИЙ — объявления, работа и специалисты Краснодарского края",
    template: "%s | БЛИЖНИЙ",
  },
  description:
    "Региональная платформа объявлений, вакансий и специалистов для Краснодарского края.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Select the backend at request time, not from an old prerendered legacy document.
  await connection();
  const mode = process.env.BLIZHNIY_AUTH_MODE;
  const backend = !mode || mode === "local" ? "legacy" : mode === "postgres" ? "postgres" : "unavailable";
  return (
    <html lang="ru">
      <head><meta name="blizhniy-auth-backend" content={backend} /></head>
      <body className="antialiased">
        <AccountAuthProvider backend={backend}>
        <BookingLegacyStorageCleanup />
        <div className="app-shell">{children}</div>
        <MobileBottomNav />
        <SiteFooter />
        </AccountAuthProvider>
      </body>
    </html>
  );
}
