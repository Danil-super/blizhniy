import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { AdminUserRow } from "@/components/admin/AdminUsersClient";

type ProfileRow = {
  created_at: string;
  display_name?: string | null;
  email?: string | null;
  id: string;
  is_blocked?: boolean | null;
  phone?: string | null;
};

type UserRoleRow = {
  role: AdminUserRow["role"];
  user_id: string;
};

type UserOwnedRow = {
  author_id?: string | null;
  user_id?: string | null;
};

type PaymentAmountRow = {
  amount: number | string;
  user_id?: string | null;
};

const rolePriority: AdminUserRow["role"][] = ["admin", "organization", "specialist", "user"];

function normalizeUserId(value?: string | null) {
  return value && isUuid(value) ? value : undefined;
}

function incrementCount(map: Map<string, number>, userId?: string | null) {
  const normalized = normalizeUserId(userId);

  if (!normalized) {
    return;
  }

  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function addPaymentAmount(map: Map<string, number>, row: PaymentAmountRow) {
  const userId = normalizeUserId(row.user_id);

  if (!userId) {
    return;
  }

  const amount = Number(row.amount);
  map.set(userId, (map.get(userId) ?? 0) + (Number.isFinite(amount) ? amount : 0));
}

function pickPrimaryRole(roles: AdminUserRow["role"][]) {
  return rolePriority.find((role) => roles.includes(role)) ?? "user";
}

async function listRowsByUserOwnership(table: string, ownerColumn: "author_id" | "user_id") {
  return supabaseRest<UserOwnedRow[]>(`/rest/v1/${table}?select=${ownerColumn}`);
}

async function optionalRows<T>(promise: Promise<T[]>, label: string) {
  return promise.catch((error) => {
    console.error(`Failed to load admin users ${label}`, error);
    return [] as T[];
  });
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  const profiles = await supabaseRest<ProfileRow[]>("/rest/v1/profiles?select=id,email,phone,display_name,is_blocked,created_at&order=created_at.desc");
  const [roles, listings, vacancies, workRequests, specialistProfiles, payments] = await Promise.all([
    optionalRows(supabaseRest<UserRoleRow[]>("/rest/v1/user_roles?select=user_id,role"), "roles"),
    optionalRows(listRowsByUserOwnership("listings", "author_id"), "listing counts"),
    optionalRows(listRowsByUserOwnership("vacancies", "author_id"), "vacancy counts"),
    optionalRows(listRowsByUserOwnership("work_requests", "author_id"), "work request counts"),
    optionalRows(listRowsByUserOwnership("specialist_profiles", "user_id"), "specialist counts"),
    optionalRows(supabaseRest<PaymentAmountRow[]>("/rest/v1/payments?select=user_id,amount&status=eq.succeeded"), "payment totals"),
  ]);

  const rolesByUserId = new Map<string, AdminUserRow["role"][]>();
  const publicationsByUserId = new Map<string, number>();
  const paymentsByUserId = new Map<string, number>();

  for (const role of roles) {
    const userId = normalizeUserId(role.user_id);

    if (!userId) {
      continue;
    }

    rolesByUserId.set(userId, [...(rolesByUserId.get(userId) ?? []), role.role]);
  }

  for (const row of listings) {
    incrementCount(publicationsByUserId, row.author_id);
  }

  for (const row of vacancies) {
    incrementCount(publicationsByUserId, row.author_id);
  }

  for (const row of workRequests) {
    incrementCount(publicationsByUserId, row.author_id);
  }

  for (const row of specialistProfiles) {
    incrementCount(publicationsByUserId, row.user_id);
  }

  for (const row of payments) {
    addPaymentAmount(paymentsByUserId, row);
  }

  return profiles.map((profile) => {
    const userRoles = rolesByUserId.get(profile.id) ?? [];
    const emailName = profile.email?.split("@")[0];
    const name = profile.display_name?.trim() || emailName || "Пользователь";

    return {
      createdAt: profile.created_at,
      email: profile.email ?? "",
      id: profile.id,
      lastActiveAt: profile.created_at,
      listingsCount: publicationsByUserId.get(profile.id) ?? 0,
      name,
      paymentsAmount: paymentsByUserId.get(profile.id) ?? 0,
      phone: profile.phone ?? "",
      role: pickPrimaryRole(userRoles),
      status: profile.is_blocked ? "blocked" : "active",
    };
  });
}

export async function updateAdminUser(input: { id: string; isBlocked?: boolean; role?: AdminUserRow["role"] }) {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  if (!isUuid(input.id)) {
    return undefined;
  }

  const [profiles, currentRoles, adminRoles] = await Promise.all([
    supabaseRest<Array<Pick<ProfileRow, "id" | "is_blocked">>>(`/rest/v1/profiles?select=id,is_blocked&id=eq.${encodeURIComponent(input.id)}&limit=1`),
    supabaseRest<Array<Pick<UserRoleRow, "role">>>(`/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(input.id)}`),
    supabaseRest<Array<Pick<UserRoleRow, "user_id">>>("/rest/v1/user_roles?select=user_id&role=eq.admin"),
  ]);
  const profile = profiles[0];

  if (!profile?.id) {
    return undefined;
  }

  const isCurrentAdmin = currentRoles.some((role) => role.role === "admin");
  const isLastAdmin = isCurrentAdmin && new Set(adminRoles.map((role) => role.user_id).filter(Boolean)).size <= 1;

  if (isLastAdmin && (input.role && input.role !== "admin")) {
    throw new Error("Нельзя снять роль у последнего администратора");
  }

  if (isLastAdmin && input.isBlocked === true) {
    throw new Error("Нельзя заблокировать последнего администратора");
  }

  if (typeof input.isBlocked === "boolean" && input.isBlocked !== Boolean(profile.is_blocked)) {
    const rows = await supabaseRest<Array<Pick<ProfileRow, "id">>>(`/rest/v1/profiles?select=id&id=eq.${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        is_blocked: input.isBlocked,
      },
    });

    if (!rows[0]?.id) {
      return undefined;
    }
  }

  if (input.role && (currentRoles.length !== 1 || currentRoles[0]?.role !== input.role)) {
    await supabaseRest(`/rest/v1/user_roles?user_id=eq.${encodeURIComponent(input.id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });

    await supabaseRest("/rest/v1/user_roles", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        role: input.role,
        user_id: input.id,
      },
    });
  }

  return (await listAdminUsers()).find((user) => user.id === input.id);
}
