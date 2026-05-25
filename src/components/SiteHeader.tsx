import Link from "next/link";
import { HeaderControls } from "@/components/HeaderControls";
import { HeaderNav } from "@/components/HeaderNav";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur">
      <div className="page-container flex min-h-24 flex-col gap-4 py-4 lg:flex-row lg:items-center">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="БЛИЖНИЙ, главная">
          <span className="flex h-12 w-12 items-center justify-center" aria-hidden="true">
            <svg className="h-12 w-12" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="10" r="5" fill="#0875D1" />
              <circle cx="36" cy="10" r="5" fill="#0AA337" />
              <path
                d="M28 46C17.5 39.6 9 34.2 9 24.8C9 18.7 13.5 14.4 19.1 14.4C23 14.4 26 16.4 28 19.3C30 16.4 33 14.4 36.9 14.4C42.5 14.4 47 18.7 47 24.8C47 34.2 38.5 39.6 28 46Z"
                stroke="#0AA337"
                strokeWidth="4.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M27.8 45.8C17.4 39.4 9 34 9 24.8C9 18.7 13.5 14.4 19.1 14.4C23.1 14.4 26.1 16.5 28 19.5"
                stroke="#0875D1"
                strokeWidth="4.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M20.5 25.5L28 33L35.5 25.5" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-3xl font-black italic tracking-normal text-[#0a1437]">БЛИЖНИЙ</span>
        </Link>

        <HeaderControls />
      </div>
      <HeaderNav />
    </header>
  );
}
