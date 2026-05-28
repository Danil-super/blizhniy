export type DemoPublicationType = "listing" | "vacancy" | "workRequest" | "specialist" | "fairApplication";

export type DemoPublication = {
  id: string;
  type: DemoPublicationType;
  title: string;
  subtitle: string;
  city: string;
  price?: string;
  description?: string;
  phone?: string;
  messengerUrl?: string;
  listingKind?: "prodam" | "kuplyu" | "menyayu" | "otdam-darom";
  categorySlug?: string;
  subcategorySlug?: string;
  status: string;
  createdAt: string;
};

export const demoPublicationsStorageKey = "blizhniy-demo-publications";

export const demoPublicationLabels: Record<DemoPublicationType, string> = {
  fairApplication: "Заявка на ярмарку",
  listing: "Объявление",
  specialist: "Анкета специалиста",
  vacancy: "Вакансия",
  workRequest: "Заказ",
};
