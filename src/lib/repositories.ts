import {
  applications,
  categories,
  cities,
  fairApplications,
  listings,
  payments,
  professions,
  region,
  specialists,
  tariffs,
  users,
  vacancies,
  workRequests,
} from "@/lib/data";
import { listApplications, listFairApplications, listListings, listMockPayments, listSpecialists, listVacancies, listWorkRequests } from "@/lib/mock-store";

export type CatalogRepository = {
  getRegion: () => typeof region;
  getCities: () => typeof cities;
  getCategories: () => typeof categories;
  getProfessions: () => typeof professions;
};

export type PublicationRepository = {
  getListings: () => typeof listings;
  getVacancies: () => typeof vacancies;
  getWorkRequests: () => typeof workRequests;
  getSpecialists: () => typeof specialists;
  getFairApplications: () => typeof fairApplications;
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
  getListings: () => listListings(),
  getVacancies: () => listVacancies(),
  getWorkRequests: () => listWorkRequests(),
  getSpecialists: () => listSpecialists(),
  getFairApplications: () => listFairApplications(),
  getUsers: () => users,
  getApplications: () => listApplications(),
  getPayments: () => listMockPayments(),
  getTariffs: () => tariffs,
};

export function getRepository(): AppRepository {
  return mockRepository;
}
