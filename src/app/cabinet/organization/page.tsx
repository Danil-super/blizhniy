import { redirect } from "next/navigation";
import { CabinetOrganizationPage } from "@/components/MvpDashboard";

export default function Page() {
  if (process.env.BLIZHNIY_AUTH_MODE === "postgres") return <CabinetOrganizationPage />;
  redirect("/cabinet/vakansii");
}
