import type {CabinetProfile} from './cabinet-profile';
import {validEmail,validPersonName,validPlainText,validWebUrl,validInn,validRegistrationNumber} from './cabinet-field-validation.ts';
import {normalizeProfilePhone} from './phone-verification-contract.ts';
import type {VacancyEmployerType} from './vacancy-requisites';

export type VacancyEmployerDefaults = {
  contactPerson?: string;
  email?: string;
  employerType?: string;
  inn?: string;
  messengerUrl?: string;
  organization?: string;
  ogrn?: string;
  ogrnip?: string;
  phone?: string;
  website?: string;
};

export type VacancyEmployerPrefill = Record<VacancyEmployerType,VacancyEmployerDefaults>;

export function vacancyEmployerPrefill(profile: CabinetProfile): VacancyEmployerPrefill {
  const name = validPersonName(profile.name) ? profile.name : undefined;
  const normalizedPhone = normalizeProfilePhone(profile.phone);
  const phone = normalizedPhone?.startsWith('+7') ? normalizedPhone : undefined;
  const contacts = {
    contactPerson: name && name.length <= 80 ? name : undefined,
    phone,
    email: validEmail(profile.email) ? profile.email || undefined : undefined,
  };
  const {organizationInn: inn, organizationOgrn: registration} = profile;
  const business = {
    organization: validPlainText(profile.organizationName) ? profile.organizationName || undefined : undefined,
    website: validWebUrl(profile.organizationWebsite) ? profile.organizationWebsite || undefined : undefined,
  };
  const isOrganization = (!inn || /^\d{10}$/.test(inn)) && (!registration || /^\d{13}$/.test(registration));
  const isEntrepreneur = (!inn || /^\d{12}$/.test(inn)) && (!registration || /^\d{15}$/.test(registration));
  const verifiedInn = validInn(inn) ? inn : undefined;
  const verifiedRegistration = validRegistrationNumber(registration) ? registration : undefined;
  return {
    organization: isOrganization ? {...contacts,...business,inn:verifiedInn,ogrn:verifiedRegistration} : contacts,
    ip: isEntrepreneur ? {...contacts,...business,inn:verifiedInn,ogrnip:verifiedRegistration} : contacts,
    person: {organization: name && name.length <= 60 ? name : undefined, phone},
  };
}
