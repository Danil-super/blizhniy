export type VacancyEmployerType = "organization" | "ip" | "person";

export type VacancyRequisitesInput = {
  employerType?: string;
  inn?: string;
  ogrn?: string;
  ogrnip?: string;
};

export type NormalizedVacancyRequisites = {
  employerType: VacancyEmployerType;
  inn: string;
  ogrn: string;
  ogrnip: string;
};

export function normalizeVacancyEmployerType(value?: string): VacancyEmployerType {
  if (value === "ip") {
    return "ip";
  }

  if (value === "person" || value === "private") {
    return "person";
  }

  return "organization";
}

export function cleanRequisiteDigits(value?: string, maxLength = 32) {
  return (value ?? "").replace(/\D/g, "").slice(0, maxLength);
}

export function normalizeVacancyRequisites(input: VacancyRequisitesInput): NormalizedVacancyRequisites {
  const employerType = normalizeVacancyEmployerType(input.employerType);

  return {
    employerType,
    inn: cleanRequisiteDigits(input.inn, employerType === "ip" ? 12 : 10),
    ogrn: employerType === "organization" ? cleanRequisiteDigits(input.ogrn, 13) : "",
    ogrnip: employerType === "ip" ? cleanRequisiteDigits(input.ogrnip, 15) : "",
  };
}

export function validateVacancyRequisites(input: NormalizedVacancyRequisites, options: { requireInn: boolean }) {
  if (input.employerType === "person") {
    return "";
  }

  if (input.employerType === "organization") {
    if ((options.requireInn || input.inn) && input.inn.length !== 10) {
      return "Для организации укажите ИНН из 10 цифр";
    }

    if (input.ogrn && input.ogrn.length !== 13) {
      return "ОГРН должен содержать 13 цифр";
    }
  }

  if (input.employerType === "ip") {
    if ((options.requireInn || input.inn) && input.inn.length !== 12) {
      return "Для ИП укажите ИНН из 12 цифр";
    }

    if (input.ogrnip && input.ogrnip.length !== 15) {
      return "ОГРНИП должен содержать 15 цифр";
    }
  }

  return "";
}
