import Link from "next/link";
import { BrandName } from "@/components/BrandName";
import { HeaderControls } from "@/components/HeaderControls";
import { HeaderNav } from "@/components/HeaderNav";
import { LogoMark } from "@/components/LogoMark";
import { MobileBottomNav } from "@/components/MobileBottomNav";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200/80 bg-white">
      <HeaderNav />
      <div className="page-container flex flex-col gap-2 pb-3 pt-0 md:flex-row md:items-center md:gap-4 md:pt-2">
        <div className="flex min-w-0 items-center justify-between gap-2 md:contents">
          <Link href="/" className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2 lg:gap-3" aria-label="БЛИЖНИЙ, главная">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center md:h-9 md:w-9" aria-hidden="true">
              <LogoMark />
            </span>
            <span className="min-w-0 whitespace-nowrap text-base font-black tracking-normal text-[#0a1437] sm:text-lg md:text-2xl">
              <BrandName />
            </span>
          </Link>
        </div>

        <HeaderControls />
      </div>
      <MobileBottomNav />
    </header>
  );
}
