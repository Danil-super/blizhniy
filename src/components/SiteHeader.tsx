import Link from "next/link";
import { HeaderActions } from "@/components/HeaderActions";
import { HeaderControls } from "@/components/HeaderControls";
import { HeaderNav } from "@/components/HeaderNav";

export function SiteHeader() {
  return (
    <header className="relative z-[100] border-b border-slate-200/80 bg-white">
      <div className="page-container grid gap-1 py-1.5 md:gap-2 md:py-3">
        <div className="flex min-h-10 items-center gap-2 sm:gap-3 md:min-h-14 md:gap-5">
          <Link
            href="/"
            className="flex min-w-0 shrink-0 items-center text-2xl font-black italic leading-none tracking-normal text-[#198b2f] sm:text-[2.1rem] md:text-[2.35rem]"
            aria-label="БЛИЖНИЙ, главная"
          >
            БЛИЖНИЙ
          </Link>
          <HeaderNav />
          <HeaderActions compact />
        </div>
        <HeaderControls placement="mobile" />
      </div>
    </header>
  );
}
