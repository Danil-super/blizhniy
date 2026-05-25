import {
  applications,
  categories,
  cities,
  listings,
  payments,
  professions,
  region,
  specialists,
  tariffs,
  users,
  vacancies,
} from "@/lib/data";

export type CatalogRepository = {
  getRegion: () => typeof region;
  getCities: () => typeof cities;
  getCategories: () => typeof categories;
  getProfessions: () => typeof professions;
};

export type PublicationRepository = {
  getListings: () => typeof listings;
  getVacancies: () => typeof vacancies;
  getSpecialists: () => typeof specialists;
};

export type AccountRepository = {
  getUsers: () => typeof users;
  getApplications: () => typeof applications;
  getPayments: () => typeof payments;
  getTariffs: () => typeof tariffs;
};

export type AppRepository = CatalogRepository & PublicationRepository & AccountRepository;

export const mockRepository: AppRepository = {
  getRegion: () => region,
  getCities: () => cities,
  getCategories: () => categories,
  getProfessions: () => professions,
  getListings: () => listings,
  getVacancies: () => vacancies,
  getSpecialists: () => specialists,
  getUsers: () => users,
  getApplications: () => applications,
  getPayments: () => payments,
  getTariffs: () => tariffs,
};

export function getRepository(): AppRepository {
  return mockRepository;
}
