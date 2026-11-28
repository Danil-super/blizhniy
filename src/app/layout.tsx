import type { Metadata } from "next";
import { Fragment, Suspense } from "react";
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
import {readDraftRemovalsEnabled,readPostmoderationEnabled} from '@/lib/listing-workflow-config';
import {ListingWorkflowProvider} from '@/components/listings/ListingWorkflowProvider';
import {readTelegramPhoneConfig} from '@/lib/telegram-phone-config';
import {PhonePlacementProvider} from '@/components/phone/PhonePlacementProvider';
import {CookieNotice} from '@/components/CookieNotice';
import {hasCookieNoticeAcknowledgement} from '@/lib/cookie-notice';
import {YandexMetrica} from '@/components/YandexMetrica';
import {getMetricaCounterId, getMetricaTransport} from '@/lib/metrica-config';
import {readWorkOwnerActionsEnabled} from '@/lib/work-owner-actions-contract';
import {readPlacementRenewalsEnabled} from '@/lib/placement-renewal-config';
import {readServiceCheckoutEnabled} from '@/lib/service-checkout-config';
import {readSpecialistCheckoutEnabled} from '@/lib/specialist-checkout-config';
import {PlacementReturnNoticeProvider} from '@/components/payments/PlacementReturnNotice';
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
  const metricaTransport = getMetricaTransport();
  const metricaCounterId = metricaTransport === null ? null : getMetricaCounterId();
  const incoming = await headers();
  const ip = getTrustedProxyIp(incoming);
  const proofExpiry = backend === "postgres" && process.env.BLIZHNIY_AUTH_REMEMBERED_CAPTCHA === "enabled" && ip
    ? readBrowserProof(incoming, process.env.BLIZHNIY_AUTH_RATE_SECRET ?? "", ip) : 0;
  return (
    <html lang="ru">
      <head>
        <meta name="blizhniy-auth-backend" content={backend} />
        {backend === "postgres" && process.env.BLIZHNIY_PUSH === "inbox-v1" && <meta name="blizhniy-push" content="enabled" />}
        {metricaCounterId !== null && <meta name="blizhniy-metrica-id" content={String(metricaCounterId)} />}
        {backend === "postgres" && process.env.BLIZHNIY_LISTING_VIEWS === "enabled" && <meta name="blizhniy-listing-views" content="enabled" />}
        <meta name="blizhniy-phone-verification" content={readTelegramPhoneConfig()?'enabled':'disabled'} />
        <meta name="blizhniy-listing-workflow" content={postmoderation?'postmoderation':'pre-moderation'} />
        <meta name="blizhniy-turnstile-site-key" content={getTurnstileSiteKey() ?? ""} />
        <meta name="blizhniy-legacy-url" content={backend === "legacy" ? getPublicRuntimeSetting("legacy-url") ?? "" : ""} />
        <meta name="blizhniy-legacy-anon-key" content={backend === "legacy" ? getPublicRuntimeSetting("legacy-anon-key") ?? "" : ""} />
        <meta name="blizhniy-dgis-key" content={getPublicRuntimeSetting("dgis-key") ?? ""} />
      </head>
      <body className="antialiased">
        <AccountAuthProvider backend={backend}>
        <ListingWorkflowProvider postmoderation={postmoderation} localSimulation={postmoderation&&process.env.BLIZHNIY_LOCAL_PRIMARY==='enabled'} workOwnerActions={readWorkOwnerActionsEnabled()} renewals={readPlacementRenewalsEnabled()} serviceCheckout={readServiceCheckoutEnabled()} specialistCheckout={readSpecialistCheckoutEnabled()} draftRemovals={readDraftRemovalsEnabled()}>
        <AccountCaptchaProvider expiresAt={proofExpiry}>
        <PhonePlacementProvider>
        <BookingLegacyStorageCleanup />
        <CookieNotice initiallyAcknowledged={hasCookieNoticeAcknowledgement(incoming.get("cookie") ?? "")} analyticsAvailable={metricaCounterId !== null} />
        <Suspense fallback={null}><YandexMetrica counterId={metricaCounterId} transport={metricaTransport} siteUrl={getPublicSiteUrl()} /></Suspense>
        {/* Isolate lazy Flight children from host replay in Next 15's bundled renderer. */}
        <PlacementReturnNoticeProvider>
          <div className="app-shell"><Fragment key="route-content">{children}</Fragment></div>
        </PlacementReturnNoticeProvider>
        <MobileBottomNav />
        <SiteFooter analyticsAvailable={metricaCounterId !== null} />
        </PhonePlacementProvider>
        </AccountCaptchaProvider>
        </ListingWorkflowProvider>
        </AccountAuthProvider>
      </body>
    </html>
  );
}
