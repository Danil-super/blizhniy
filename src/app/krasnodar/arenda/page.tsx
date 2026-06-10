import { ListingKindPage } from "@/components/listings/ListingPages";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Аренда и бронирование",
  description: "Турбазы, гостиницы, походы и другие объекты для бронирования на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/arenda",
  },
};

export default function Page() {
  return <ListingKindPage kind="arenda" />;
}
