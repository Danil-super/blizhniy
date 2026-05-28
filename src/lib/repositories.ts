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
  users,
  vacancies,
  workRequests,
} from "@/lib/data";
import { listApplications, listFairApplications, listListings, listMockPayments, listSpecialists, listVacancies, listWorkRequests } from "@/lib/mock-store";
import { getTariffs } from "@/lib/tariff-store";

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
  getTariffs: () => ReturnType<typeof getTariffs>;
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
  getTariffs: () => getTariffs(),
};

export function getRepository(): AppRepository {
  return mockRepository;
}
