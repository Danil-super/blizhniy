import { notFound } from "next/navigation";
import { PrivateDraftsPage } from "@/components/listings/PrivateDraftsPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Черновики объявлений", robots: { index: false, follow: false } };
export default function Page() {
  if (process.env.BLIZHNIY_AUTH_MODE !== "postgres") notFound();
  return <PrivateDraftsPage />;
}
