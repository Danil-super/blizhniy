import { markStoredFairApplicationPaid } from "@/lib/fair-application-store";
import { getStoredApplicationOwner, markStoredApplicationPaid } from "@/lib/application-store";
import { createStoredNotification } from "@/lib/notification-store";
import { markStoredListingPaid } from "@/lib/listing-store";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import { getTariffs } from "@/lib/tariff-store";
import type { Payment, Tariff } from "@/lib/types";
import { markStoredVacancyPaid } from "@/lib/vacancy-store";
import { markStoredWorkRequestPaid } from "@/lib/work-request-store";

type PaymentRow = {
  amount: number | string;
  created_at: string;
  id: string;
  paid_at?: string | null;
  provider: Payment["provider"];
  provider_payment_id?: string | null;
  status: Payment["status"] | "refunded";
  target_id: string;
  target_type: Payment["targetType"];
  tariff_id?: string | null;
  user_id?: string | null;
};

type TariffRow = {
  action: Tariff["action"];
  id: string;
  name: string;
  price: number | string;
};

type ApplicationTitleRow = {
  id: string;
  specialist_name?: string | null;
  vacancies?: {
    title?: string | null;
  } | null;
  work_requests?: {
    title?: string | null;
  } | null;
};

type FairApplicationTitleRow = {
  id: string;
  participant_name: string;
};

type StoredPaymentInput = {
  amount: number;
  id: string;
  provider: Payment["provider"];
  providerPaymentId?: string;
  status: Payment["status"];
  targetId?: string;
  targetTitle: string;
  targetType: Payment["targetType"];
  tariff: Tariff;
  userId?: string;
};

export function canStorePayment(input: { targetId?: string }) {
  return isSupabaseRestConfigured() && Boolean(input.targetId);
}

function tariffIdFromAction(action: Tariff["action"]) {
  return getTariffs().find((tariff) => tariff.action === action)?.id ?? action;
}

async function getStoredTariffByAction(action: Tariff["action"]) {
  const rows = await supabaseRest<TariffRow[]>(
    `/rest/v1/tariffs?select=id,name,action,price&action=eq.${encodeURIComponent(action)}&limit=1`,
  );

  return rows[0];
}

async function getPaymentTariffRow(input: StoredPaymentInput) {
  const tariff = await getStoredTariffByAction(input.tariff.action);

  if (tariff) {
    return tariff;
  }

  if (input.targetType === "workRequest" && input.tariff.action === "work_request_publication") {
    return getStoredTariffByAction("listing_publication");
  }

  return undefined;
}

function targetTitleForPayment(row: PaymentRow, context?: PaymentMappingContext) {
  if (row.target_type === "application") {
    return context?.applicationTitlesById.get(row.target_id) ?? "Отклик на вакансию";
  }

  if (row.target_type === "fair_application") {
    return context?.fairApplicationTitlesById.get(row.target_id) ?? "Заявка на ярмарку";
  }

  return "Платеж";
}

type PaymentMappingContext = {
  applicationTitlesById: Map<string, string>;
  fairApplicationTitlesById: Map<string, string>;
  tariffActionsById: Map<string, Tariff["action"]>;
};

async function buildPaymentMappingContext(rows: PaymentRow[]): Promise<PaymentMappingContext> {
  const tariffIds = Array.from(new Set(rows.map((row) => row.tariff_id).filter((id): id is string => Boolean(id))));
  const applicationIds = Array.from(new Set(rows.filter((row) => row.target_type === "application").map((row) => row.target_id).filter(isUuid)));
  const fairApplicationIds = Array.from(new Set(rows.filter((row) => row.target_type === "fair_application").map((row) => row.target_id).filter(isUuid)));

  const [tariffRows, applicationRows, fairApplicationRows] = await Promise.all([
    tariffIds.length
      ? supabaseRest<Array<Pick<TariffRow, "action" | "id">>>(
          `/rest/v1/tariffs?select=id,action&id=in.${encodeURIComponent(`(${tariffIds.join(",")})`)}`,
        )
      : Promise.resolve([]),
    applicationIds.length
      ? supabaseRest<ApplicationTitleRow[]>(
          `/rest/v1/applications?select=id,specialist_name,vacancies(title),work_requests(title)&id=in.${encodeURIComponent(`(${applicationIds.join(",")})`)}`,
        )
      : Promise.resolve([]),
    fairApplicationIds.length
      ? supabaseRest<FairApplicationTitleRow[]>(
          `/rest/v1/fair_applications?select=id,participant_name&id=in.${encodeURIComponent(`(${fairApplicationIds.join(",")})`)}`,
        )
      : Promise.resolve([]),
  ]);

  return {
    applicationTitlesById: new Map(
      applicationRows.map((row) => {
        const specialistName = row.specialist_name?.trim() || "Специалист";
        const workRequestTitle = row.work_requests?.title?.trim();
        const vacancyTitle = row.vacancies?.title?.trim();
        const title = workRequestTitle
          ? `Отклик ${specialistName} на заказ ${workRequestTitle}`
          : `Отклик ${specialistName} на вакансию ${vacancyTitle || "Вакансия"}`;

        return [row.id, title];
      }),
    ),
    fairApplicationTitlesById: new Map(
      fairApplicationRows.map((row) => [row.id, row.participant_name ? `Заявка на ярмарку: ${row.participant_name}` : "Заявка на ярмарку"]),
    ),
    tariffActionsById: new Map(tariffRows.map((row) => [row.id, row.action])),
  };
}

export async function mapStoredPayment(row: PaymentRow, context?: PaymentMappingContext): Promise<Payment> {
  const resolvedContext = context ?? (await buildPaymentMappingContext([row]));
  const tariffAction = row.tariff_id ? resolvedContext.tariffActionsById.get(row.tariff_id) : undefined;

  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: targetTitleForPayment(row, resolvedContext),
    tariffId: tariffIdFromAction(tariffAction ?? (await getTariffActionById(row.tariff_id)) ?? "listing_publication"),
    amount: Number(row.amount),
    status: row.status,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id ?? undefined,
    createdAt: row.created_at.slice(0, 10),
    paidAt: row.paid_at?.slice(0, 10),
  };
}

async function getTariffActionById(tariffId?: string | null) {
  if (!tariffId) {
    return undefined;
  }

  const rows = await supabaseRest<Array<Pick<TariffRow, "action">>>(
    `/rest/v1/tariffs?select=action&id=eq.${encodeURIComponent(tariffId)}&limit=1`,
  );

  return rows[0]?.action;
}

export async function createStoredPayment(input: StoredPaymentInput) {
  const tariff = await getPaymentTariffRow(input);

  if (!tariff) {
    throw new Error(`Tariff ${input.tariff.action} is not configured in Supabase`);
  }

  const rows = await supabaseRest<PaymentRow[]>("/rest/v1/payments?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
      id: input.id,
      user_id: input.userId ?? null,
      tariff_id: tariff.id,
      target_type: input.targetType,
      target_id: input.targetId,
      provider: input.provider,
      provider_payment_id: input.providerPaymentId ?? null,
      amount: input.amount,
      status: input.status,
      paid_at: input.status === "succeeded" ? new Date().toISOString() : null,
    },
  });

  return rows[0] ? mapStoredPayment(rows[0]) : undefined;
}

export async function getStoredPayment(paymentId: string) {
  if (!isSupabaseRestConfigured() || !isUuid(paymentId)) {
    return undefined;
  }

  const rows = await supabaseRest<PaymentRow[]>(`/rest/v1/payments?select=*&id=eq.${encodeURIComponent(paymentId)}&limit=1`);

  return rows[0] ? mapStoredPayment(rows[0]) : undefined;
}

export async function listStoredPayments() {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  const rows = await supabaseRest<PaymentRow[]>("/rest/v1/payments?select=*&order=created_at.desc");
  const context = await buildPaymentMappingContext(rows);
  const payments = await Promise.all(rows.map((row) => mapStoredPayment(row, context)));

  return payments;
}

export async function listStoredPaymentsForUser(userId: string) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  const rows = await supabaseRest<PaymentRow[]>(
    `/rest/v1/payments?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
  );
  const context = await buildPaymentMappingContext(rows);
  const payments = await Promise.all(rows.map((row) => mapStoredPayment(row, context)));

  return payments;
}

export async function getLatestPendingStoredPaymentForUser(userId: string) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  const createdAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await supabaseRest<PaymentRow[]>(
    `/rest/v1/payments?select=*&user_id=eq.${encodeURIComponent(userId)}&provider=eq.yookassa&status=in.(created,pending)&created_at=gte.${encodeURIComponent(createdAfter)}&order=created_at.desc&limit=1`,
  );

  return rows[0] ? mapStoredPayment(rows[0]) : undefined;
}

export async function findActiveStoredPaymentForTarget(input: {
  targetId?: string;
  targetType: Payment["targetType"];
  userId?: string;
}) {
  if (!isSupabaseRestConfigured() || !input.targetId || !isUuid(input.targetId)) {
    return undefined;
  }

  const userFilter = input.userId ? `&user_id=eq.${encodeURIComponent(input.userId)}` : "";
  const rows = await supabaseRest<PaymentRow[]>(
    `/rest/v1/payments?select=*&target_type=eq.${encodeURIComponent(input.targetType)}&target_id=eq.${encodeURIComponent(input.targetId)}${userFilter}&status=in.(created,pending)&order=created_at.desc&limit=1`,
  );

  return rows[0] ? mapStoredPayment(rows[0]) : undefined;
}

export async function findStoredPaymentByProvider(providerPaymentId: string, localPaymentId?: string) {
  if (!isSupabaseRestConfigured()) {
    return undefined;
  }

  if (localPaymentId && isUuid(localPaymentId)) {
    const payment = await getStoredPayment(localPaymentId);

    if (payment) {
      return payment;
    }
  }

  const rows = await supabaseRest<PaymentRow[]>(
    `/rest/v1/payments?select=*&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
  );

  return rows[0] ? mapStoredPayment(rows[0]) : undefined;
}

export async function updateStoredPayment(payment: Payment) {
  if (!isSupabaseRestConfigured() || !isUuid(payment.id)) {
    return payment;
  }

  await supabaseRest(`/rest/v1/payments?id=eq.${encodeURIComponent(payment.id)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      paid_at: payment.status === "succeeded" ? new Date().toISOString() : payment.paidAt ?? null,
      provider: payment.provider,
      provider_payment_id: payment.providerPaymentId ?? null,
      status: payment.status,
    },
  });

  return payment;
}

export async function markStoredPaymentTargetSucceeded(payment: Payment) {
  if (payment.targetType === "listing" && payment.targetId && isUuid(payment.targetId)) {
    const updated = await markStoredListingPaid(payment.targetId);

    if (!updated) {
      throw new Error("Не удалось опубликовать объявление после оплаты");
    }

    return "published" as const;
  }

  if (payment.targetType === "fair_application" && payment.targetId && isUuid(payment.targetId)) {
    await markStoredFairApplicationPaid(payment.targetId);
    return "published" as const;
  }

  if (payment.targetType === "vacancy" && payment.targetId && isUuid(payment.targetId)) {
    const updated = await markStoredVacancyPaid(payment.targetId);

    if (!updated) {
      throw new Error("Не удалось опубликовать вакансию после оплаты");
    }

    return "published" as const;
  }

  if (payment.targetType === "workRequest" && payment.targetId && isUuid(payment.targetId)) {
    await markStoredWorkRequestPaid(payment.targetId);
    return "published" as const;
  }

  if (payment.targetType === "application" && payment.targetId && isUuid(payment.targetId)) {
    const updated = await markStoredApplicationPaid(payment.targetId);

    if (!updated) {
      throw new Error("Не удалось отправить отклик после оплаты");
    }

    const owner = await getStoredApplicationOwner(payment.targetId);

    if (updated === "sent" && owner?.ownerUserId) {
      await createStoredNotification({
        body: `Исполнитель оплатил и отправил отклик на «${owner.targetTitle}». Откройте раздел «Отклики», чтобы посмотреть анкету и контакты.`,
        event: "application_paid",
        subject: owner.targetType === "workRequest" ? "Новый отклик на заказ" : "Новый отклик на вакансию",
        userId: owner.ownerUserId,
      });
    }

    return "sent" as const;
  }

  return payment.targetType === "application" ? ("sent" as const) : ("published" as const);
}
