import { getStoredVacancyById } from "@/lib/vacancy-store";
import { getStoredWorkRequestById } from "@/lib/work-request-store";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { Application, Payment } from "@/lib/types";

type ApplicationRow = {
  id: string;
  applicant_user_id?: string | null;
  vacancy_id?: string | null;
  work_request_id?: string | null;
  specialist_profile_id?: string | null;
  message?: string | null;
  status: Application["status"];
  is_paid: boolean;
  specialist_name?: string | null;
  specialist_profession?: string | null;
  specialist_price?: string | null;
  specialist_skills?: string | null;
  specialist_phone?: string | null;
  specialist_email?: string | null;
  specialist_messenger_url?: string | null;
  created_at: string;
  sent_at?: string | null;
  vacancies?: {
    title?: string | null;
    author_id?: string | null;
  } | null;
  work_requests?: {
    title?: string | null;
    author_id?: string | null;
  } | null;
  specialist_profiles?: {
    name?: string | null;
    contact_phone?: string | null;
    email?: string | null;
    messenger_url?: string | null;
    price_from?: number | string | null;
    skills?: string[] | null;
    specialist_categories?: {
      name?: string | null;
    } | null;
  } | null;
};

type PaymentRow = {
  id: string;
  status: Payment["status"];
  target_id: string;
  created_at: string;
};

type CreateStoredApplicationInput = {
  applicantUserId: string;
  message?: string;
  snapshot: {
    email?: string;
    messengerUrl?: string;
    name: string;
    phone?: string;
    price?: string;
    profession?: string;
    skills?: string;
  };
  specialistProfileId: string;
  vacancyId?: string;
  workRequestId?: string;
};

export type ApplicationOwnerInfo = {
  applicantUserId?: string;
  ownerUserId?: string;
  targetTitle: string;
  targetType: "vacancy" | "workRequest";
};

const applicationSelect =
  "id,applicant_user_id,vacancy_id,work_request_id,specialist_profile_id,message,status,is_paid,specialist_name,specialist_profession,specialist_price,specialist_skills,specialist_phone,specialist_email,specialist_messenger_url,created_at,sent_at,vacancies(title,author_id),work_requests(title,author_id),specialist_profiles(name,contact_phone,email,messenger_url,price_from,skills,specialist_categories(name))";
const vacancyOwnerApplicationSelect = applicationSelect.replace("vacancies(", "vacancies!inner(");
const workRequestOwnerApplicationSelect = applicationSelect.replace("work_requests(", "work_requests!inner(");

function latestPayment(payments?: PaymentRow[] | null) {
  return [...(payments ?? [])].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
}

function formatPriceFrom(value?: number | string | null) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return `от ${new Intl.NumberFormat("ru-RU").format(numeric).replace(/\u00a0/g, " ")} ₽`;
}

function skillsText(row: ApplicationRow) {
  if (row.specialist_skills) {
    return row.specialist_skills;
  }

  const skills = row.specialist_profiles?.skills;
  return Array.isArray(skills) && skills.length ? skills.join(", ") : undefined;
}

function rowTargetType(row: ApplicationRow): "vacancy" | "workRequest" {
  return row.work_request_id ? "workRequest" : "vacancy";
}

function rowTargetTitle(row: ApplicationRow) {
  return row.work_requests?.title || row.vacancies?.title || (rowTargetType(row) === "workRequest" ? "Заказ" : "Вакансия");
}

function mapApplication(row: ApplicationRow, viewer: "applicant" | "employer" = "applicant", payments?: PaymentRow[] | null): Application {
  const payment = latestPayment(payments);
  const specialistName = row.specialist_name || row.specialist_profiles?.name || "Специалист";
  const profession = row.specialist_profession || row.specialist_profiles?.specialist_categories?.name || undefined;
  const targetType = rowTargetType(row);
  const targetTitle = rowTargetTitle(row);

  return {
    id: row.id,
    createdAt: row.created_at,
    email: viewer === "employer" && row.is_paid ? row.specialist_email || row.specialist_profiles?.email || undefined : undefined,
    employerMode: viewer === "employer",
    message: row.message ?? undefined,
    messengerUrl: viewer === "employer" && row.is_paid ? row.specialist_messenger_url || row.specialist_profiles?.messenger_url || undefined : undefined,
    paymentId: payment?.id,
    paymentStatus: payment?.status,
    phone: viewer === "employer" && row.is_paid ? row.specialist_phone || row.specialist_profiles?.contact_phone || undefined : undefined,
    price: row.specialist_price || formatPriceFrom(row.specialist_profiles?.price_from),
    profession,
    sentAt: row.sent_at ?? undefined,
    skills: skillsText(row),
    specialistProfileId: row.specialist_profile_id ?? undefined,
    specialistHref: row.specialist_profile_id ? `/specialist/${row.specialist_profile_id}` : undefined,
    specialistName,
    status: row.status,
    targetType,
    vacancyId: row.vacancy_id ?? undefined,
    vacancyTitle: targetTitle,
    workRequestId: row.work_request_id ?? undefined,
    workRequestTitle: row.work_requests?.title ?? undefined,
  };
}

async function paymentRowsForApplicationIds(applicationIds: string[]) {
  const ids = applicationIds.filter(isUuid);

  if (!ids.length) {
    return new Map<string, PaymentRow[]>();
  }

  const rows = await supabaseRest<PaymentRow[]>(
    `/rest/v1/payments?select=id,target_id,status,created_at&target_type=eq.application&target_id=in.(${ids.map(encodeURIComponent).join(",")})&order=created_at.desc`,
  ).catch(() => []);
  const byTargetId = new Map<string, PaymentRow[]>();

  for (const row of rows) {
    byTargetId.set(row.target_id, [...(byTargetId.get(row.target_id) ?? []), row]);
  }

  return byTargetId;
}

async function mapApplications(rows: ApplicationRow[], viewer: "applicant" | "employer" = "applicant") {
  const paymentsByTargetId = await paymentRowsForApplicationIds(rows.map((row) => row.id));

  return rows.map((row) => mapApplication(row, viewer, paymentsByTargetId.get(row.id)));
}

export async function createStoredApplication(input: CreateStoredApplicationInput) {
  const targetId = input.workRequestId ?? input.vacancyId;

  if (!isSupabaseRestConfigured() || !isUuid(targetId)) {
    return undefined;
  }

  const existing = input.workRequestId
    ? await findStoredWorkRequestApplicationForApplicant(input.workRequestId, input.applicantUserId)
    : input.vacancyId
      ? await findStoredApplicationForApplicant(input.vacancyId, input.applicantUserId)
      : undefined;

  if (existing) {
    if (existing.status === "pending_payment" || existing.status === "paid") {
      const rows = await supabaseRest<ApplicationRow[]>(
        `/rest/v1/applications?select=${applicationSelect}&id=eq.${encodeURIComponent(existing.id)}&applicant_user_id=eq.${encodeURIComponent(input.applicantUserId)}&status=in.(pending_payment,paid)`,
        {
          method: "PATCH",
          prefer: "return=representation",
          body: {
            message: input.message || null,
            specialist_email: input.snapshot.email || null,
            specialist_messenger_url: input.snapshot.messengerUrl || null,
            specialist_name: input.snapshot.name,
            specialist_phone: input.snapshot.phone || null,
            specialist_price: input.snapshot.price || null,
            specialist_profession: input.snapshot.profession || null,
            specialist_profile_id: input.specialistProfileId,
            specialist_skills: input.snapshot.skills || null,
            updated_at: new Date().toISOString(),
          },
        },
      ).catch(() => []);

      return (await mapApplications(rows))[0] ?? existing;
    }

    return existing;
  }

  const rows = await supabaseRest<ApplicationRow[]>(`/rest/v1/applications?select=${applicationSelect}`, {
    method: "POST",
    prefer: "return=representation",
    body: {
      applicant_user_id: input.applicantUserId,
      vacancy_id: input.vacancyId ?? null,
      work_request_id: input.workRequestId ?? null,
      message: input.message || null,
      status: "pending_payment",
      is_paid: false,
      specialist_profile_id: input.specialistProfileId,
      specialist_name: input.snapshot.name,
      specialist_profession: input.snapshot.profession || null,
      specialist_price: input.snapshot.price || null,
      specialist_skills: input.snapshot.skills || null,
      specialist_phone: input.snapshot.phone || null,
      specialist_email: input.snapshot.email || null,
      specialist_messenger_url: input.snapshot.messengerUrl || null,
    },
  }).catch(async (error) => {
    const concurrentExisting = input.workRequestId
      ? await findStoredWorkRequestApplicationForApplicant(input.workRequestId, input.applicantUserId).catch(() => undefined)
      : input.vacancyId
        ? await findStoredApplicationForApplicant(input.vacancyId, input.applicantUserId).catch(() => undefined)
        : undefined;

    if (concurrentExisting) {
      return [];
    }

    throw error;
  });

  if (!rows.length) {
    return input.workRequestId
      ? findStoredWorkRequestApplicationForApplicant(input.workRequestId, input.applicantUserId)
      : input.vacancyId
        ? findStoredApplicationForApplicant(input.vacancyId, input.applicantUserId)
        : undefined;
  }

  return (await mapApplications(rows))[0];
}

export async function findStoredApplicationForApplicant(vacancyId: string, applicantUserId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(vacancyId)) {
    return undefined;
  }

  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&vacancy_id=eq.${encodeURIComponent(vacancyId)}&applicant_user_id=eq.${encodeURIComponent(applicantUserId)}&order=created_at.desc&limit=1`,
  );

  return (await mapApplications(rows))[0];
}

export async function findStoredWorkRequestApplicationForApplicant(workRequestId: string, applicantUserId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(workRequestId)) {
    return undefined;
  }

  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&work_request_id=eq.${encodeURIComponent(workRequestId)}&applicant_user_id=eq.${encodeURIComponent(applicantUserId)}&order=created_at.desc&limit=1`,
  );

  return (await mapApplications(rows))[0];
}

export async function getStoredApplicationForApplicant(applicationId: string, applicantUserId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(applicationId)) {
    return undefined;
  }

  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&id=eq.${encodeURIComponent(applicationId)}&applicant_user_id=eq.${encodeURIComponent(applicantUserId)}&limit=1`,
  );

  return (await mapApplications(rows))[0];
}

export async function listStoredApplicationsForUser(userId: string) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  const [ownRows, vacancyOwnerRows, workRequestOwnerRows] = await Promise.all([
    supabaseRest<ApplicationRow[]>(
      `/rest/v1/applications?select=${applicationSelect}&applicant_user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
    ).catch(() => []),
    supabaseRest<ApplicationRow[]>(
      `/rest/v1/applications?select=${vacancyOwnerApplicationSelect}&vacancies.author_id=eq.${encodeURIComponent(userId)}&status=in.(sent,viewed,selected,rejected)&order=sent_at.desc.nullslast,created_at.desc`,
    ).catch(() => []),
    supabaseRest<ApplicationRow[]>(
      `/rest/v1/applications?select=${workRequestOwnerApplicationSelect}&work_requests.author_id=eq.${encodeURIComponent(userId)}&status=in.(sent,viewed,selected,rejected)&order=sent_at.desc.nullslast,created_at.desc`,
    ).catch(() => []),
  ]);

  const own = await mapApplications(ownRows, "applicant");
  const vacancyOwner = await mapApplications(
    vacancyOwnerRows.filter((row) => !ownRows.some((ownRow) => ownRow.id === row.id)),
    "employer",
  );
  const workRequestOwner = await mapApplications(
    workRequestOwnerRows.filter(
      (row) => !ownRows.some((ownRow) => ownRow.id === row.id) && !vacancyOwnerRows.some((vacancyRow) => vacancyRow.id === row.id),
    ),
    "employer",
  );

  return [...own, ...vacancyOwner, ...workRequestOwner].sort((left, right) => new Date(right.createdAt ?? "").getTime() - new Date(left.createdAt ?? "").getTime());
}

export async function markStoredApplicationPaid(applicationId: string): Promise<"sent" | "already_sent" | false> {
  if (!isSupabaseRestConfigured() || !isUuid(applicationId)) {
    return false;
  }

  const now = new Date().toISOString();
  const rows = await supabaseRest<Array<Pick<ApplicationRow, "id">>>(
    `/rest/v1/applications?select=id&id=eq.${encodeURIComponent(applicationId)}&status=in.(pending_payment,paid)`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        is_paid: true,
        sent_at: now,
        status: "sent",
        updated_at: now,
      },
    },
  );

  if (rows[0]?.id) {
    return "sent";
  }

  const existingRows = await supabaseRest<Array<Pick<ApplicationRow, "id" | "is_paid" | "status">>>(
    `/rest/v1/applications?select=id,is_paid,status&id=eq.${encodeURIComponent(applicationId)}&limit=1`,
  ).catch(() => []);
  const existing = existingRows[0];

  if (existing?.is_paid && ["sent", "viewed", "selected", "rejected"].includes(existing.status)) {
    return "already_sent";
  }

  return false;
}

async function applicationBelongsToOwner(applicationId: string, ownerUserId: string) {
  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&id=eq.${encodeURIComponent(applicationId)}&limit=1`,
  ).catch(() => []);
  const row = rows[0];

  return Boolean(row && (row.vacancies?.author_id === ownerUserId || row.work_requests?.author_id === ownerUserId));
}

export async function markStoredApplicationViewed(applicationId: string, ownerUserId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(applicationId)) {
    return undefined;
  }

  const allowed = await applicationBelongsToOwner(applicationId, ownerUserId);

  if (!allowed) {
    return undefined;
  }

  const now = new Date().toISOString();
  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&id=eq.${encodeURIComponent(applicationId)}&status=eq.sent`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        status: "viewed",
        updated_at: now,
      },
    },
  );

  return (await mapApplications(rows, "employer"))[0];
}

export async function updateStoredApplicationDecision(applicationId: string, ownerUserId: string, status: "selected" | "rejected") {
  if (!isSupabaseRestConfigured() || !isUuid(applicationId)) {
    return undefined;
  }

  const allowed = await applicationBelongsToOwner(applicationId, ownerUserId);

  if (!allowed) {
    return undefined;
  }

  const now = new Date().toISOString();
  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&id=eq.${encodeURIComponent(applicationId)}&status=in.(sent,viewed)`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        status,
        updated_at: now,
      },
    },
  );

  return (await mapApplications(rows, "employer"))[0];
}

export async function ensureVacancyCanReceiveApplication(vacancyId: string, applicantUserId: string) {
  const vacancy = await getStoredVacancyById(vacancyId, { publicOnly: true });

  if (!vacancy) {
    throw new Error("Вакансия не найдена или снята с публикации.");
  }

  const rows = await supabaseRest<Array<{ author_id: string }>>(
    `/rest/v1/vacancies?select=author_id&id=eq.${encodeURIComponent(vacancyId)}&status=eq.published&limit=1`,
  );

  if (rows[0]?.author_id === applicantUserId) {
    throw new Error("Нельзя откликнуться на собственную вакансию.");
  }

  return vacancy;
}

export async function ensureWorkRequestCanReceiveApplication(workRequestId: string, applicantUserId: string) {
  const workRequest = await getStoredWorkRequestById(workRequestId);

  if (!workRequest || workRequest.status !== "published") {
    throw new Error("Заказ не найден или снят с публикации.");
  }

  const rows = await supabaseRest<Array<{ author_id: string }>>(
    `/rest/v1/work_requests?select=author_id&id=eq.${encodeURIComponent(workRequestId)}&status=eq.published&limit=1`,
  );

  if (rows[0]?.author_id === applicantUserId) {
    throw new Error("Нельзя откликнуться на собственный заказ.");
  }

  return workRequest;
}

export async function applicationTitle(applicationId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(applicationId)) {
    return undefined;
  }

  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&id=eq.${encodeURIComponent(applicationId)}&limit=1`,
  );
  const application = (await mapApplications(rows))[0];

  if (!application) {
    return undefined;
  }

  return application.targetType === "workRequest"
    ? `Отклик ${application.specialistName} на заказ ${application.workRequestTitle ?? application.vacancyTitle}`
    : `Отклик ${application.specialistName} на вакансию ${application.vacancyTitle}`;
}

export async function getStoredApplicationForPayment(applicationId: string, userId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(applicationId)) {
    return undefined;
  }

  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&id=eq.${encodeURIComponent(applicationId)}&applicant_user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  const application = (await mapApplications(rows))[0];

  if (!application || application.status === "sent" || application.status === "viewed" || application.status === "selected" || application.status === "rejected") {
    return undefined;
  }

  return application;
}

export async function getStoredApplicationOwner(applicationId: string): Promise<ApplicationOwnerInfo | undefined> {
  if (!isSupabaseRestConfigured() || !isUuid(applicationId)) {
    return undefined;
  }

  const rows = await supabaseRest<ApplicationRow[]>(
    `/rest/v1/applications?select=${applicationSelect}&id=eq.${encodeURIComponent(applicationId)}&limit=1`,
  ).catch(() => []);
  const row = rows[0];

  if (!row) {
    return undefined;
  }

  return {
    applicantUserId: row.applicant_user_id ?? undefined,
    ownerUserId: row.work_requests?.author_id ?? row.vacancies?.author_id ?? undefined,
    targetTitle: rowTargetTitle(row),
    targetType: rowTargetType(row),
  };
}
