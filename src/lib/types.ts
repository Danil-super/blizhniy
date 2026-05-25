export type PublicationStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "published"
  | "archived"
  | "expired"
  | "rejected";

export type City = {
  slug: string;
  name: string;
  regionSlug: string;
};

export type Category = {
  slug: string;
  name: string;
  children: string[];
};

export type JobVacancy = {
  id: string;
  organization: string;
  title: string;
  profession: string;
  city: string;
  salary: string;
  logoText: string;
  logoTone: "blue" | "violet" | "teal";
  phone?: string;
  messengerUrl?: string;
  status: PublicationStatus;
};

export type SpecialistProfile = {
  id: string;
  name: string;
  profession: string;
  skills: string;
  city: string;
  price: string;
  imageSeed: string;
  phone?: string;
  messengerUrl?: string;
  videoUrl?: string;
  status: PublicationStatus;
};

export type Profession = {
  parent: string;
  name: string;
  slug: string;
  active: boolean;
};
