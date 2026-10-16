import type { Metadata } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { AccountCaptchaProvider } from "@/components/auth/AccountCaptchaProvider";
import { readBrowserProof } from "@/lib/account-browser-proof";
import { getTrustedProxyIp } from "@/lib/trusted-proxy-ip";
import { AccountAuthProvider } from "@/components/auth/AccountAuthProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { BookingLegacyStorageCleanup } from "@/components/BookingLegacyStorageCleanup";
import { getPublicSiteUrl } from "@/lib/site-url";
import { getTurnstileSiteKey } from "@/lib/turnstile-public-config";
import { getPublicRuntimeSetting } from "@/lib/public-runtime-config";
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
  const incoming = await headers();
  const ip = getTrustedProxyIp(incoming);
  const proofExpiry = backend === "postgres" && process.env.BLIZHNIY_AUTH_REMEMBERED_CAPTCHA === "enabled" && ip
    ? readBrowserProof(incoming, process.env.BLIZHNIY_AUTH_RATE_SECRET ?? "", ip) : 0;
  return (
    <html lang="ru">
      <head>
        <meta name="blizhniy-auth-backend" content={backend} />
        <meta name="blizhniy-turnstile-site-key" content={getTurnstileSiteKey() ?? ""} />
        <meta name="blizhniy-legacy-url" content={backend === "legacy" ? getPublicRuntimeSetting("legacy-url") ?? "" : ""} />
        <meta name="blizhniy-legacy-anon-key" content={backend === "legacy" ? getPublicRuntimeSetting("legacy-anon-key") ?? "" : ""} />
        <meta name="blizhniy-dgis-key" content={getPublicRuntimeSetting("dgis-key") ?? ""} />
      </head>
      <body className="antialiased">
        <AccountAuthProvider backend={backend}>
        <AccountCaptchaProvider expiresAt={proofExpiry}>
        <BookingLegacyStorageCleanup />
        <div className="app-shell">{children}</div>
        <MobileBottomNav />
        <SiteFooter />
        </AccountCaptchaProvider>
        </AccountAuthProvider>
      </body>
    </html>
  );
}
