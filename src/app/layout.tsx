import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://blizhniy.vercel.app"),
  title: {
    default: "БЛИЖНИЙ — объявления, работа и специалисты Краснодарского края",
    template: "%s | БЛИЖНИЙ",
  },
  description:
    "Региональная платформа объявлений, вакансий и специалистов для Краснодарского края.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">
        <div className="app-shell">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
