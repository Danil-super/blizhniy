import { isSupabaseRestConfigured, isSupabaseServiceRoleConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import { getTariffs } from "@/lib/tariff-store";
import type { Payment, Tariff } from "@/lib/types";

type PaymentRow = {
  amount: number | string;
  created_at: string;
  id: string;
  paid_at?: string | null;
  target_applied_at?: string | null;
  purchased_duration_days?: number | null;
  fulfillment_status?: Payment["fulfillmentStatus"];
  fulfillment_reason?: Payment["fulfillmentReason"] | null;
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

type CheckoutAuthorizationRow = {
  payment_id: string;
  user_id?: string | null;
  target_type?: Payment["targetType"];
  target_id?: string;
  amount?: number | string;
  purchased_duration_days?: number | null;
  tariff_key?: string;
  merchant_shop_id?: string;
  is_test?: boolean;
  request_body?: string | null;
  request_sha256?: string | null;
  first_attempt_authorized_at?: string | null;
  remaining_ms?: number | string | null;
  provider_payment_id?: string | null;
  financial_status?: Payment["status"];
  decision: "post" | "recover" | "legacy_recover" | "manual";
};

export type StoredYooKassaCheckoutAuthorization = {
  decision: "post" | "recover" | "legacy_recover";
  requestBody?: string;
  remainingMs?: number;
  providerPaymentId?: string;
  tariffKey?: string;
};

type CheckoutMerchant = { shopId: string; isTest: boolean };

function checkoutVerificationError() {
  // Database/parser/receipt errors must not expose the persisted PII/body.
  return new Error("YooKassa checkout snapshot requires manual verification");
}

function checkoutBindings(payment: Payment, merchant: CheckoutMerchant) {
  if (!isSupabaseServiceRoleConfigured() || !isUuid(payment.id) || payment.provider !== "yookassa" ||
      !payment.targetId || !isUuid(payment.targetId) || !/^[a-zA-Z0-9_-]{1,64}$/.test(merchant.shopId)) {
    throw checkoutVerificationError();
  }
  return { p_payment_id: payment.id, p_user_id: payment.userId ?? null,
    p_target_type: payment.targetType, p_target_id: payment.targetId,
    p_merchant_shop_id: merchant.shopId, p_is_test: merchant.isTest };
}

async function decodeCheckoutAuthorization(
  row: CheckoutAuthorizationRow | undefined, payment: Payment, merchant: CheckoutMerchant, started: number,
): Promise<StoredYooKassaCheckoutAuthorization> {
  if (!row || row.payment_id !== payment.id || row.decision === "manual" ||
      !["post", "recover", "legacy_recover"].includes(row.decision) ||
      (payment.providerPaymentId && row.provider_payment_id !== payment.providerPaymentId)) {
    throw checkoutVerificationError();
  }
  const providerPaymentId = row.provider_payment_id ?? undefined;
  if (row.decision === "legacy_recover") {
    // Explicit historical GET-only exception. Never manufacture provenance.
    if (!providerPaymentId || row.request_body) throw checkoutVerificationError();
    return { decision: row.decision, providerPaymentId };
  }
  if (row.user_id !== payment.userId || row.target_type !== payment.targetType || row.target_id !== payment.targetId ||
      Number(row.amount) !== payment.amount || (row.purchased_duration_days ?? null) !== (payment.purchasedDurationDays ?? null) ||
      row.merchant_shop_id !== merchant.shopId || row.is_test !== merchant.isTest ||
      typeof row.tariff_key !== "string" || !row.tariff_key || row.tariff_key.length > 128 ||
      typeof row.first_attempt_authorized_at !== "string" || !Number.isFinite(Date.parse(row.first_attempt_authorized_at)) ||
      typeof row.request_body !== "string" || typeof row.request_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.request_sha256)) {
    throw checkoutVerificationError();
  }
  const bytes = new TextEncoder().encode(row.request_body);
  if (bytes.byteLength > 16 * 1024) throw checkoutVerificationError();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (digest !== row.request_sha256) throw checkoutVerificationError();
  const remainingMs = Number(row.remaining_ms) - Math.max(0, performance.now() - started);
  if (row.decision === "post" && (!Number.isFinite(remainingMs) || remainingMs <= 0 || providerPaymentId)) {
    throw checkoutVerificationError();
  }
  if (row.decision === "recover" && !providerPaymentId) throw checkoutVerificationError();
  return { decision: row.decision, providerPaymentId, requestBody: row.request_body,
    remainingMs, tariffKey: row.tariff_key };
}

export async function authorizeStoredYooKassaCheckoutAttempt(payment: Payment, merchant: CheckoutMerchant) {
  const started = performance.now();
  try {
    const rows = await supabaseRest<CheckoutAuthorizationRow[]>("/rest/v1/rpc/authorize_yookassa_checkout_attempt", {
      method: "POST", attempts: 1, useServiceRole: true, body: checkoutBindings(payment, merchant),
    });
    return await decodeCheckoutAuthorization(rows[0], payment, merchant, started);
  } catch {
    throw checkoutVerificationError();
  }
}

export async function prepareStoredYooKassaCheckoutIntent(payment: Payment, requestBody: string, merchant: CheckoutMerchant) {
  const started = performance.now();
  try {
    if (!payment.userId || !isUuid(payment.userId) || new TextEncoder().encode(requestBody).byteLength > 16 * 1024) {
      throw checkoutVerificationError();
    }
    const rows = await supabaseRest<CheckoutAuthorizationRow[]>("/rest/v1/rpc/prepare_yookassa_checkout_intent", {
      method: "POST", attempts: 1, useServiceRole: true,
      body: { ...checkoutBindings(payment, merchant), p_tariff_key: payment.tariffId,
        p_amount: payment.amount, p_purchased_duration_days: payment.purchasedDurationDays ?? null,
        p_request_body: requestBody },
    });
    return await decodeCheckoutAuthorization(rows[0], payment, merchant, started);
  } catch {
    throw checkoutVerificationError();
  }
}

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
  const resolvedTariffAction = tariffAction ?? await getTariffActionById(row.tariff_id);

  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: targetTitleForPayment(row, resolvedContext),
    tariffId: resolvedTariffAction ? tariffIdFromAction(resolvedTariffAction) : row.tariff_id ?? "",
    amount: Number(row.amount),
    status: row.status,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id ?? undefined,
    createdAt: row.created_at,
    paidAt: row.paid_at ?? undefined,
    targetAppliedAt: row.target_applied_at ?? undefined,
    purchasedDurationDays: row.purchased_duration_days ?? null,
    fulfillmentStatus: row.fulfillment_status ?? "pending",
    fulfillmentReason: row.fulfillment_reason ?? undefined,
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
  const requiresDuration = ["listing", "vacancy", "workRequest", "ad_marquee"].includes(input.targetType);
  const duration = requiresDuration ? input.tariff.durationDays : null;
  if (requiresDuration && (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 365)) {
    throw new Error("Purchased payment duration must be an integer from 1 through 365");
  }
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
      paid_at: null,
      purchased_duration_days: duration,
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

  // The database trigger preserves committed settlement state even when this
  // request loaded an older snapshot. Always use the returned authoritative row.
  const rows = await supabaseRest<PaymentRow[]>(`/rest/v1/payments?select=*&id=eq.${encodeURIComponent(payment.id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      paid_at: payment.paidAt ?? null,
      provider: payment.provider,
      provider_payment_id: payment.providerPaymentId ?? null,
      status: payment.status,
    },
  });

  const stored = rows[0];
  if (!stored) {
    throw new Error("Stored payment was not found during update");
  }

  payment.status = stored.status;
  payment.paidAt = stored.paid_at ?? undefined;
  payment.targetAppliedAt = stored.target_applied_at ?? undefined;
  payment.provider = stored.provider;
  payment.providerPaymentId = stored.provider_payment_id ?? undefined;
  payment.userId = stored.user_id ?? undefined;
  payment.targetId = stored.target_id;
  payment.targetType = stored.target_type;
  payment.createdAt = stored.created_at;
  payment.purchasedDurationDays = stored.purchased_duration_days ?? null;
  payment.fulfillmentStatus = stored.fulfillment_status ?? "pending";
  payment.fulfillmentReason = stored.fulfillment_reason ?? undefined;

  return payment;
}

type FulfillmentRow = {
  payment_id: string;
  financial_status: Payment["status"];
  fulfillment_status: NonNullable<Payment["fulfillmentStatus"]>;
  fulfillment_reason: Payment["fulfillmentReason"] | null;
  paid_at: string | null;
  target_applied_at: string | null;
  applied_now: boolean;
  target_status: string | null;
};

const fulfillmentReasons: ReadonlyArray<NonNullable<Payment["fulfillmentReason"]>> = [
  "payment_owner_missing", "unsupported_target_type", "payment_missing_paid_at",
  "duration_missing", "target_missing", "target_owner_mismatch", "target_not_eligible",
  "entitlement_expired", "parent_missing", "parent_not_eligible", "target_changed",
];

function isFulfillmentRow(value: unknown, paymentId: string): value is FulfillmentRow {
  if (!value || typeof value !== "object") return false;
  const row = value as FulfillmentRow;
  return row.payment_id === paymentId
    && ["created", "pending", "succeeded", "failed", "refunded"].includes(row.financial_status)
    && ["pending", "applied", "blocked"].includes(row.fulfillment_status)
    && (row.fulfillment_status === "blocked"
      ? fulfillmentReasons.includes(row.fulfillment_reason as NonNullable<Payment["fulfillmentReason"]>) && row.target_applied_at === null
      : row.fulfillment_reason === null)
    && (row.paid_at === null || typeof row.paid_at === "string")
    && (row.target_applied_at === null || typeof row.target_applied_at === "string")
    && (row.fulfillment_status !== "applied" || Boolean(row.target_applied_at))
    && typeof row.applied_now === "boolean"
    && (row.target_status === null || typeof row.target_status === "string");
}

export async function applyStoredPaymentFulfillment(payment: Payment) {
  if (!isSupabaseServiceRoleConfigured() || !isUuid(payment.id) || payment.provider !== "yookassa" || !payment.providerPaymentId) {
    throw new Error("Persisted YooKassa payment and service-role storage are required for fulfillment");
  }
  const rows = await supabaseRest<unknown>("/rest/v1/rpc/apply_payment_fulfillment", {
    method: "POST", useServiceRole: true, attempts: 1,
    body: { p_payment_id: payment.id, p_expected_provider_payment_id: payment.providerPaymentId },
  });
  if (!Array.isArray(rows) || rows.length !== 1 || !isFulfillmentRow(rows[0], payment.id)) {
    throw new Error("Invalid payment fulfillment result");
  }
  const row = rows[0];
  payment.status = row.financial_status;
  payment.fulfillmentStatus = row.fulfillment_status;
  payment.fulfillmentReason = row.fulfillment_reason ?? undefined;
  payment.paidAt = row.paid_at ?? undefined;
  payment.targetAppliedAt = row.target_applied_at ?? undefined;
  const status = row.target_status;
  const nextStatus: "active" | "paid" | "published" | "sent" | undefined = payment.status === "succeeded" && payment.fulfillmentStatus === "applied"
    && (status === "active" || status === "paid" || status === "published" || status === "sent") ? status : undefined;
  return { payment, nextStatus, appliedNow: row.applied_now };
}
