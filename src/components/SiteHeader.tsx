import Image from "next/image";
import Link from "next/link";
import { HeaderActions } from "@/components/HeaderActions";
import { HeaderControls } from "@/components/HeaderControls";
import { HeaderNav } from "@/components/HeaderNav";
import { MobileBottomNav } from "@/components/MobileBottomNav";

export function SiteHeader() {
  return (
    <header className="relative z-[100] border-b border-slate-200/80 bg-white">
      <div className="page-container grid gap-2 py-2 md:py-3">
        <div className="flex min-h-12 items-center gap-2 sm:gap-3 md:min-h-14 md:gap-5">
          <Link href="/" className="flex min-w-0 shrink-0 items-center" aria-label="БЛИЖНИЙ, главная">
            <Image
              src="/brand/logo-header.png"
              alt="БЛИЖНИЙ"
              width={360}
              height={81}
              priority
              className="h-9 w-auto object-contain sm:h-12 md:h-14"
            />
          </Link>
          <HeaderNav />
          <HeaderActions compact />
        </div>
        <HeaderControls placement="mobile" />
      </div>
      <MobileBottomNav />
    </header>
  );
}
