"use client";

import dynamic from "next/dynamic";
import {usePrimaryAccountAuth} from "@/components/auth/AccountAuthProvider";
import {CabinetProfileFailure,useCookieCabinetProfile} from "./CookieCabinetProfileProvider";
import {PrivateDraftsPanel} from "@/components/listings/PrivateDraftsPage";
import {WorkPublicationsPanel} from "@/components/work/WorkPublicationsPanel";
import {ServicePublicationsPanel} from "@/components/services/ServicePublicationsPanel";
import {ApplicationsPanel} from "@/components/applications/ApplicationsPanel";
import type {DemoPublicationType} from "@/lib/demo-publications";
import type {CabinetResponseItem} from "./CabinetClient";

export {CabinetCapabilities} from "./CabinetCapabilities";
export type {CabinetPaymentHistoryItem} from "./CabinetClient";

const CookieCabinetOrganization = dynamic(() => import("./CabinetOrganization").then(module => module.CookieCabinetOrganization));
const PrimaryPaymentHistory = dynamic(() => import("./PrimaryPaymentHistory").then(module => module.PrimaryPaymentHistory));

const LegacyOverview = dynamic(() => import("./CabinetClient").then(module => module.CabinetOverviewClient));
const LegacyPublications = dynamic(() => import("./CabinetClient").then(module => module.CabinetPublicationsClient));
const LegacyResponses = dynamic(() => import("./CabinetClient").then(module => module.CabinetResponsesClient));
const LegacySpecialist = dynamic(() => import("./CabinetClient").then(module => module.CabinetSpecialistClient));
const LegacyOrganization = dynamic(() => import("./CabinetClient").then(module => module.CabinetOrganizationClient));
const LegacyPayments = dynamic(() => import("./CabinetClient").then(module => module.CabinetPaymentsClient));

export function CabinetOverviewClient() {
  const primary = usePrimaryAccountAuth();
  const cookie = useCookieCabinetProfile();
  if (!primary) return <LegacyOverview />;
  if (cookie && !cookie.loading && cookie.error && !cookie.profile) return <CabinetProfileFailure message={cookie.error} reload={cookie.reload} />;
  return <PrivateDraftsPanel />;
}

export function CabinetPublicationsClient({type}: {type: DemoPublicationType}) {
  const primary = usePrimaryAccountAuth();
  if (primary && type === "listing") return <PrivateDraftsPanel />;
  if (primary && (type === "vacancy" || type === "workRequest")) return <WorkPublicationsPanel kind={type} />;
  if (primary && type === "fairApplication") return <ServicePublicationsPanel kind="fair" />;
  return <LegacyPublications type={type} />;
}

export function CabinetResponsesClient({responses = []}: {responses?: CabinetResponseItem[]}) {
  return usePrimaryAccountAuth() ? <ApplicationsPanel /> : <LegacyResponses responses={responses} />;
}

export function CabinetSpecialistClient() {
  return usePrimaryAccountAuth() ? <ServicePublicationsPanel kind="specialist" /> : <LegacySpecialist />;
}

export function CabinetOrganizationClient(){
 return usePrimaryAccountAuth()?<CookieCabinetOrganization/>:<LegacyOrganization/>;
}
export function CabinetPaymentsClient(props:{initialPayments?:import("./CabinetClient").CabinetPaymentHistoryItem[]}){
 return usePrimaryAccountAuth()?<PrimaryPaymentHistory/>:<LegacyPayments {...props}/>;
}
