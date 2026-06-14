export const appConfig = {
  publicBasePath: "/",
  defaultRegionSlug: "krasnodarskiy-kray",
  defaultCitySlug: "krasnodar",
  publicationDays: 30,
  auth: {
    provider: "email-password",
    allowMultipleRoles: true,
    adminEmailEnv: "ADMIN_EMAIL",
  },
  payments: {
    provider: process.env.PAYMENT_PROVIDER === "yookassa" ? "yookassa" : "mock",
  },
} as const;

export const protectedRoutes = ["/cabinet", "/admin"] as const;
export const adminRoutes = ["/admin"] as const;
