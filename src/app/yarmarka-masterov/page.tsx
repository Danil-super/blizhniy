import { SiteHeader } from "@/components/SiteHeader";
import { FairHomePage } from "@/components/FairPages";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <SiteHeader />
      <FairHomePage />
    </>
  );
}
