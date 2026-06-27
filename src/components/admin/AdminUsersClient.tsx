"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, CheckCircle2, Eye, Mail, Phone, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

export type AdminUserRow = {
  createdAt: string;
  email: string;
  id: string;
  lastActiveAt: string;
  listingsCount: number;
  name: string;
  paymentsAmount: number;
  phone: string;
  role: "admin" | "organization" | "specialist" | "user";
  status: "active" | "blocked";
};

type RoleFilter = "all" | AdminUserRow["role"];
type StatusFilter = "all" | AdminUserRow["status"];

type UsersApiResponse = {
  error?: string;
  users?: AdminUserRow[];
};

type UpdateUserResponse = {
  error?: string;
  user?: AdminUserRow;
};

const roleOptions: Array<{ label: string; value: AdminUserRow["role"] }> = [
  { label: "Пользователь", value: "user" },
  { label: "Организация", value: "organization" },
  { label: "Специалист", value: "specialist" },
  { label: "Администратор", value: "admin" },
];

const roleLabels: Record<AdminUserRow["role"], string> = {
  admin: "Администратор",
  organization: "Организация",
  specialist: "Специалист",
  user: "Пользователь",
};

const statusLabels: Record<AdminUserRow["status"], string> = {
  active: "Активен",
  blocked: "Заблокирован",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatContact(value: string, fallback: string) {
  return value.trim() || fallback;
}

function shortId(value: string) {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function UserStatusBadge({ status }: { status: AdminUserRow["status"] }) {
  const className = status === "active" ? "border-emerald-200 bg-emerald-50 text-[#0a8f32]" : "border-red-200 bg-red-50 text-red-700";

  return <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-bold ${className}`}>{statusLabels[status]}</span>;
}

function UsersMetricCard({ icon, label, value, detail }: { detail: string; icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold leading-4 text-slate-500">{label}</p>
          <p className="mt-1.5 line-clamp-1 text-xl font-bold leading-tight text-[#060b27]">{value}</p>
          <p className="mt-1 line-clamp-1 text-xs leading-4 text-slate-600">{detail}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">{icon}</span>
      </div>
    </article>
  );
}

async function getAccessToken() {
  if (!isSupabaseBrowserConfigured()) {
    return "";
  }

  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? "";
}

export function AdminUsersClient() {
  const [loadedUsers, setLoadedUsers] = useState<AdminUserRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [actionUserId, setActionUserId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const selectedPanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      setState("loading");
      setError("");

      try {
        const token = await getAccessToken();
        const response = await fetch("/api/admin/users", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as UsersApiResponse | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Не удалось загрузить пользователей");
        }

        if (active) {
          setLoadedUsers(payload?.users ?? []);
          setState("ready");
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить пользователей");
          setState("error");
        }
      }
    }

    loadUsers();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedUserId) {
      return;
    }

    window.requestAnimationFrame(() => {
      selectedPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [selectedUserId]);

  async function updateUser(userId: string, patch: { isBlocked?: boolean; role?: AdminUserRow["role"] }) {
    const currentUser = loadedUsers.find((user) => user.id === userId);

    if (!currentUser) {
      return;
    }

    if (patch.role && patch.role === currentUser.role) {
      return;
    }

    if (typeof patch.isBlocked === "boolean" && patch.isBlocked === (currentUser.status === "blocked")) {
      return;
    }

    if (patch.role) {
      const confirmed = window.confirm(`Изменить роль пользователя "${currentUser.name}" на "${roleLabels[patch.role]}"?`);

      if (!confirmed) {
        return;
      }
    }

    if (typeof patch.isBlocked === "boolean") {
      const actionLabel = patch.isBlocked ? "заблокировать" : "разблокировать";
      const confirmed = window.confirm(`Вы уверены, что хотите ${actionLabel} пользователя "${currentUser.name}"?`);

      if (!confirmed) {
        return;
      }
    }

    setActionUserId(userId);
    setError("");
    setMessage("");

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/admin/users", {
        body: JSON.stringify({ id: userId, ...patch }),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as UpdateUserResponse | null;

      if (!response.ok || !payload?.user) {
        throw new Error(payload?.error ?? "Не удалось обновить пользователя");
      }

      setLoadedUsers((current) => current.map((user) => (user.id === payload.user?.id ? payload.user : user)));
      setMessage(`Пользователь "${payload.user.name}" обновлен.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Не удалось обновить пользователя");
    } finally {
      setActionUserId("");
    }
  }

  const activeUsers = loadedUsers.filter((user) => user.status === "active").length;
  const blockedUsers = loadedUsers.length - activeUsers;
  const organizations = loadedUsers.filter((user) => user.role === "organization").length;
  const totalPayments = loadedUsers.reduce((sum, user) => sum + user.paymentsAmount, 0);

  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return loadedUsers.filter((user) => {
      const matchesQuery = normalizedQuery
        ? [user.id, user.name, user.email, user.phone, roleLabels[user.role]].some((value) => value.toLowerCase().includes(normalizedQuery))
        : true;
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus = statusFilter === "all" || user.status === statusFilter;

      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [loadedUsers, query, roleFilter, statusFilter]);

  const selectedUser = selectedUserId ? loadedUsers.find((user) => user.id === selectedUserId) : undefined;

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <UsersMetricCard icon={<UsersRound className="h-5 w-5" />} label="Всего" value={String(loadedUsers.length)} detail={`${activeUsers} активных аккаунтов`} />
        <UsersMetricCard icon={<ShieldCheck className="h-5 w-5" />} label="Организации" value={String(organizations)} detail="Профили компаний и работодателей" />
        <UsersMetricCard icon={<Ban className="h-5 w-5" />} label="Блокировки" value={String(blockedUsers)} detail="Требуют проверки администратора" />
        <UsersMetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Оплаты" value={`${formatAmount(totalPayments)} ₽`} detail="Сумма по пользователям" />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="grid gap-3 border-b border-slate-100 p-3 sm:grid-cols-[minmax(240px,1fr)_auto_auto] sm:p-4">
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 focus-within:border-blue-200 focus-within:bg-white">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по имени, email, телефону или ID"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#0875d1]"
          >
            <option value="all">Все роли</option>
            <option value="user">Пользователи</option>
            <option value="organization">Организации</option>
            <option value="specialist">Специалисты</option>
            <option value="admin">Администраторы</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#0875d1]"
          >
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="blocked">Заблокированные</option>
          </select>
        </div>

        {selectedUser ? (
          <section ref={selectedPanelRef} className="border-b border-blue-100 bg-blue-50/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-[#0875d1]">Карточка пользователя</p>
                <h2 className="mt-1 break-words text-xl font-bold text-[#060b27]">{selectedUser.name}</h2>
                <p className="mt-1 break-all font-mono text-xs font-semibold text-slate-500">{selectedUser.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserId("")}
                className="inline-flex h-9 w-fit items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]"
              >
                Закрыть
              </button>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <dt className="text-xs font-bold text-slate-500">Контакты</dt>
                <dd className="mt-1 break-words text-sm font-semibold text-slate-700">{formatContact(selectedUser.email, "Email не указан")}</dd>
                <dd className="mt-1 text-sm font-semibold text-slate-700">{formatContact(selectedUser.phone, "Телефон не указан")}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <dt className="text-xs font-bold text-slate-500">Роль и статус</dt>
                <dd className="mt-1 text-sm font-bold text-[#060b27]">{roleLabels[selectedUser.role]}</dd>
                <dd className="mt-2">
                  <UserStatusBadge status={selectedUser.status} />
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <dt className="text-xs font-bold text-slate-500">Активность</dt>
                <dd className="mt-1 text-sm font-bold text-[#060b27]">{selectedUser.listingsCount} публикаций</dd>
                <dd className="mt-1 text-sm font-semibold text-slate-700">Создан: {formatDate(selectedUser.createdAt)}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <dt className="text-xs font-bold text-slate-500">Оплаты</dt>
                <dd className="mt-1 text-sm font-bold text-[#060b27]">{formatAmount(selectedUser.paymentsAmount)} ₽</dd>
                <dd className="mt-1 text-sm font-semibold text-slate-700">Сумма успешных платежей</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <div className="hidden max-h-[65dvh] overflow-auto lg:block">
          <table className="w-full min-w-[1120px] table-fixed border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-sm text-slate-500">
              <tr>
                <th className="w-[250px] border-b border-slate-200 px-5 py-4 font-bold">Пользователь</th>
                <th className="w-[240px] border-b border-slate-200 px-5 py-4 font-bold">Контакты</th>
                <th className="w-[160px] border-b border-slate-200 px-5 py-4 font-bold">Роль</th>
                <th className="w-[140px] border-b border-slate-200 px-5 py-4 font-bold">Статус</th>
                <th className="w-[180px] border-b border-slate-200 px-5 py-4 font-bold">Профиль</th>
                <th className="w-[150px] border-b border-slate-200 px-5 py-4 font-bold">Публикации</th>
                <th className="w-[190px] border-b border-slate-200 px-5 py-4 font-bold">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleUsers.map((user) => (
                <tr className="text-slate-700" key={user.id}>
                  <td className="px-5 py-4 align-top">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
                        <UserRound className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="break-words font-bold text-[#060b27]">{user.name}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500" title={user.id}>{shortId(user.id)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="grid gap-1.5 text-xs font-semibold text-slate-600">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words">{formatContact(user.email, "Email не указан")}</span>
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>{formatContact(user.phone, "Телефон не указан")}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <select
                      value={user.role}
                      disabled={actionUserId === user.id}
                      onChange={(event) => updateUser(user.id, { role: event.target.value as AdminUserRow["role"] })}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-[#0875d1] disabled:opacity-60"
                    >
                      {roleOptions.map((role) => (
                        <option value={role.value} key={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <UserStatusBadge status={user.status} />
                  </td>
                  <td className="px-5 py-4 align-top text-xs font-semibold text-slate-600">
                    <p>Создан: {formatDate(user.createdAt)}</p>
                    <p className="mt-1 text-slate-500">{user.email ? "Email указан" : "Email не указан"}</p>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <p className="font-bold text-[#060b27]">{user.listingsCount}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{formatAmount(user.paymentsAmount)} ₽ оплат</p>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(user.id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Детали
                      </button>
                      <a href={user.email ? `mailto:${user.email}` : undefined} aria-disabled={!user.email} className="inline-flex h-9 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1] aria-disabled:pointer-events-none aria-disabled:opacity-50">
                        Написать
                      </a>
                      <button
                        type="button"
                        disabled={actionUserId === user.id}
                        onClick={() => updateUser(user.id, { isBlocked: user.status === "active" })}
                        className="inline-flex h-9 items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 disabled:opacity-60"
                      >
                        {user.status === "active" ? "Блок" : "Разблок"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 p-3 lg:hidden">
          {visibleUsers.map((user) => (
            <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" key={user.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
                    <UserRound className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-bold text-[#060b27]">{user.name}</h2>
                    <p className="mt-1 break-all font-mono text-xs text-slate-500">{user.id}</p>
                  </div>
                </div>
                <UserStatusBadge status={user.status} />
              </div>
              <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600">
                <p className="break-words">{formatContact(user.email, "Email не указан")}</p>
                <p className="break-words">{formatContact(user.phone, "Телефон не указан")}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <span className="rounded-lg bg-slate-50 px-3 py-2 font-bold text-slate-700">{roleLabels[user.role]}</span>
                  <span className="rounded-lg bg-slate-50 px-3 py-2 font-bold text-slate-700">{user.listingsCount} публикаций</span>
                  <span className="rounded-lg bg-slate-50 px-3 py-2 font-bold text-slate-700">{formatAmount(user.paymentsAmount)} ₽ оплат</span>
                  <span className="rounded-lg bg-slate-50 px-3 py-2 font-bold text-slate-700">Создан {formatDate(user.createdAt)}</span>
                </div>
                <select
                  value={user.role}
                  disabled={actionUserId === user.id}
                  onChange={(event) => updateUser(user.id, { role: event.target.value as AdminUserRow["role"] })}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#0875d1] disabled:opacity-60"
                >
                  {roleOptions.map((role) => (
                    <option value={role.value} key={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Детали
                </button>
                <a href={user.email ? `mailto:${user.email}` : undefined} aria-disabled={!user.email} className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#0875d1] aria-disabled:pointer-events-none aria-disabled:opacity-50">
                  Написать
                </a>
                <button
                  type="button"
                  disabled={actionUserId === user.id}
                  onClick={() => updateUser(user.id, { isBlocked: user.status === "active" })}
                  className="col-span-2 inline-flex h-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 disabled:opacity-60"
                >
                  {user.status === "active" ? "Блокировать" : "Разблокировать"}
                </button>
              </div>
            </article>
          ))}
        </div>

        {state === "loading" ? <p className="px-4 py-8 text-sm font-semibold text-slate-500">Загружаем пользователей...</p> : null}
        {state === "error" ? <p className="px-4 py-8 text-sm font-semibold text-red-700">{error}</p> : null}
        {state !== "error" && error ? <p className="px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {message ? <p className="px-4 py-3 text-sm font-semibold text-[#0a8f32]">{message}</p> : null}
        {state === "ready" && !visibleUsers.length ? <p className="px-4 py-8 text-sm font-semibold text-slate-500">Пользователи не найдены.</p> : null}
      </section>
    </div>
  );
}
