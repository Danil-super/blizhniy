import { markStoredFairApplicationPaid } from "@/lib/fair-application-store";
import { markStoredListingPaid } from "@/lib/listing-store";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import { getTariffs } from "@/lib/tariff-store";
import type { Payment, Tariff } from "@/lib/types";

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

async function getFairApplicationTitle(targetId: string) {
  if (!isUuid(targetId)) {
    return undefined;
  }

  const rows = await supabaseRest<FairApplicationTitleRow[]>(
    `/rest/v1/fair_applications?select=id,participant_name&id=eq.${encodeURIComponent(targetId)}&limit=1`,
  );
  const participantName = rows[0]?.participant_name;

  return participantName ? `Заявка на ярмарку: ${participantName}` : undefined;
}

async function targetTitleForPayment(row: PaymentRow) {
  if (row.target_type === "fair_application") {
    return (await getFairApplicationTitle(row.target_id)) ?? "Заявка на ярмарку";
  }

  return "Платеж";
}

export async function mapStoredPayment(row: PaymentRow): Promise<Payment> {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: await targetTitleForPayment(row),
    tariffId: tariffIdFromAction((await getTariffActionById(row.tariff_id)) ?? "listing_publication"),
    amount: Number(row.amount),
    status: row.status === "refunded" ? "failed" : row.status,
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
  const tariff = await getStoredTariffByAction(input.tariff.action);

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
    return [];
  }

  const rows = await supabaseRest<PaymentRow[]>("/rest/v1/payments?select=*&order=created_at.desc");
  const payments = await Promise.all(rows.map((row) => mapStoredPayment(row)));

  return payments;
}

export async function listStoredPaymentsForUser(userId: string) {
  if (!isSupabaseRestConfigured()) {
    return [];
  }

  const rows = await supabaseRest<PaymentRow[]>(
    `/rest/v1/payments?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
  );
  const payments = await Promise.all(rows.map((row) => mapStoredPayment(row)));

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

  return payment.targetType === "application" ? ("sent" as const) : ("published" as const);
}
