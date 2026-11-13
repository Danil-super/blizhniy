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
import {readPostmoderationEnabled} from '@/lib/listing-workflow-config';
import {ListingWorkflowProvider} from '@/components/listings/ListingWorkflowProvider';
import {readTelegramPhoneConfig} from '@/lib/telegram-phone-config';
import {PhonePlacementProvider} from '@/components/phone/PhonePlacementProvider';
import {CookieNotice} from '@/components/CookieNotice';
import {readWorkOwnerActionsEnabled} from '@/lib/work-owner-actions-contract';
import {readPlacementRenewalsEnabled} from '@/lib/placement-renewal-config';
import {readServiceCheckoutEnabled} from '@/lib/service-checkout-config';
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
  const postmoderation=readPostmoderationEnabled();
  const incoming = await headers();
  const ip = getTrustedProxyIp(incoming);
  const proofExpiry = backend === "postgres" && process.env.BLIZHNIY_AUTH_REMEMBERED_CAPTCHA === "enabled" && ip
    ? readBrowserProof(incoming, process.env.BLIZHNIY_AUTH_RATE_SECRET ?? "", ip) : 0;
  return (
    <html lang="ru">
      <head>
        <meta name="blizhniy-auth-backend" content={backend} />
        <meta name="blizhniy-phone-verification" content={readTelegramPhoneConfig()?'enabled':'disabled'} />
        <meta name="blizhniy-listing-workflow" content={postmoderation?'postmoderation':'pre-moderation'} />
        <meta name="blizhniy-turnstile-site-key" content={getTurnstileSiteKey() ?? ""} />
        <meta name="blizhniy-legacy-url" content={backend === "legacy" ? getPublicRuntimeSetting("legacy-url") ?? "" : ""} />
        <meta name="blizhniy-legacy-anon-key" content={backend === "legacy" ? getPublicRuntimeSetting("legacy-anon-key") ?? "" : ""} />
        <meta name="blizhniy-dgis-key" content={getPublicRuntimeSetting("dgis-key") ?? ""} />
      </head>
      <body className="antialiased">
        <AccountAuthProvider backend={backend}>
        <ListingWorkflowProvider postmoderation={postmoderation} localSimulation={postmoderation&&process.env.BLIZHNIY_LOCAL_PRIMARY==='enabled'} workOwnerActions={readWorkOwnerActionsEnabled()} renewals={readPlacementRenewalsEnabled()} serviceCheckout={readServiceCheckoutEnabled()}>
        <AccountCaptchaProvider expiresAt={proofExpiry}>
        <PhonePlacementProvider>
        <BookingLegacyStorageCleanup />
        <CookieNotice />
        <div className="app-shell">{children}</div>
        <MobileBottomNav />
        <SiteFooter />
        </PhonePlacementProvider>
        </AccountCaptchaProvider>
        </ListingWorkflowProvider>
        </AccountAuthProvider>
      </body>
    </html>
  );
}
