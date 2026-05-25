export type AppRole = "user" | "specialist" | "organization" | "admin";

export const roleLabels: Record<AppRole, string> = {
  user: "Пользователь",
  specialist: "Специалист",
  organization: "Организация",
  admin: "Администратор",
};

export const defaultRoles: AppRole[] = ["user"];

export function canAccessAdmin(roles: AppRole[]) {
  return roles.includes("admin");
}

export function canCreateSpecialistProfile(roles: AppRole[]) {
  return roles.includes("user") || roles.includes("specialist") || roles.includes("admin");
}

export function canCreateVacancy(roles: AppRole[]) {
  return roles.includes("user") || roles.includes("organization") || roles.includes("admin");
}

export function canCreateListing(roles: AppRole[]) {
  return roles.includes("user") || roles.includes("admin");
}
