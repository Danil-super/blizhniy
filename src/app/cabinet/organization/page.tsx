import { redirect } from "next/navigation";
import { CabinetOrganizationPage } from "@/components/cabinet/CabinetPages";

export default function Page() {
  if (process.env.BLIZHNIY_AUTH_MODE === "postgres") return <CabinetOrganizationPage />;
  redirect("/cabinet/vakansii");
}
