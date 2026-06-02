import Link from "next/link";
import { BrandName } from "@/components/BrandName";
import { HeaderControls } from "@/components/HeaderControls";
import { HeaderNav } from "@/components/HeaderNav";
import { LogoMark } from "@/components/LogoMark";
import { MobileBottomNav } from "@/components/MobileBottomNav";

export function SiteHeader() {
  return (
    <header className="relative z-[100] border-b border-slate-200/80 bg-white">
      <HeaderNav />
      <div className="page-container flex items-center gap-2 pb-3 pt-0 sm:gap-3 md:gap-4 md:pt-2">
        <div className="flex min-w-0 shrink-0 items-center">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2.5 lg:gap-3.5" aria-label="БЛИЖНИЙ, главная">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center sm:h-12 sm:w-12 md:h-14 md:w-14" aria-hidden="true">
              <LogoMark />
            </span>
            <span className="min-w-0 whitespace-nowrap bg-gradient-to-r from-[#050b24] via-[#0b2f74] to-[#0875d1] bg-clip-text text-sm font-black tracking-normal text-transparent drop-shadow-[0_1px_0_rgba(255,255,255,0.95)] sm:text-lg md:text-2xl">
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
