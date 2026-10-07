import { listMockPayments, markPaymentTargetSucceeded } from "@/lib/mock-store";
import {
  canStorePayment,
  applyStoredPaymentFulfillment,
  createStoredPayment,
  findActiveStoredPaymentForTarget,
  findStoredPaymentByProvider,
  getStoredPayment,
  listStoredPayments,
  updateStoredPayment,
} from "@/lib/payment-store";
import { shouldAllowMockPayments } from "@/lib/runtime-mode";
import { getPublicSiteUrl } from "@/lib/site-url";
import { isSupabaseRestConfigured } from "@/lib/supabase-rest";
import { getActiveStoredTariffById } from "@/lib/tariff-store";
import type { Payment, Tariff } from "@/lib/types";

type PaymentTargetType = Payment["targetType"];
type YooKassaPaymentStatus = "pending" | "waiting_for_capture" | "succeeded" | "canceled";
type YooKassaPaymentResponse = {
  amount: { value: string; currency: "RUB" };
  capturedAt?: string;
  confirmation?: {
    type: "redirect";
    confirmation_url: string;
  };
  id: string;
  paid: boolean;
  status: YooKassaPaymentStatus;
  test: boolean;
  metadata?: Record<string, string | null>;
};

type YooKassaNotificationPayload = {
  event?: string;
  object?: YooKassaPaymentResponse;
};

export type CreatePaymentInput = {
  customerEmail?: string;
  tariffId: string;
  targetId?: string;
  targetType?: PaymentTargetType;
  targetTitle?: string;
  userId?: string;
};

export type PaymentResult = {
  payment: Payment;
  nextStatus?: "active" | "paid" | "published" | "sent";
  notification: {
    subject: string;
    body: string;
  };
};

type ConfirmPaymentOptions = {
  trustSuccessfulReturn?: boolean;
};

const tariffTargetTypes: Record<Tariff["action"], PaymentTargetType> = {
  ad_marquee: "ad_marquee",
  fair_participation: "fair_application",
  job_response: "application",
  listing_publication: "listing",
  specialist_publication: "specialist",
  vacancy_publication: "vacancy",
  work_request_publication: "workRequest",
};

const pendingYooKassaPaymentCreations = new Map<string, Promise<Payment>>();
const pendingSucceededPaymentApplications = new Map<string, Promise<PaymentResult>>();

export function resolveTargetType(tariff: Pick<Tariff, "action">): PaymentTargetType {
  return tariffTargetTypes[tariff.action] ?? "listing";
}

export function validatePaymentTargetTypeForTariff(tariff: Pick<Tariff, "action" | "name">, targetType?: PaymentTargetType) {
  const expectedTargetType = resolveTargetType(tariff);

  if (targetType && targetType !== expectedTargetType) {
    throw new Error(`Tariff ${tariff.name} is only valid for ${expectedTargetType} payments`);
  }

  return expectedTargetType;
}

function resolveTargetTitle(tariff: Tariff, targetTitle?: string) {
  return targetTitle?.trim() || tariff.name;
}

function createPaymentId() {
  return crypto.randomUUID();
}

function createMockPaymentId() {
  return `pay-mock-${Date.now().toString(36)}`;
}

function getReceiptVatCode() {
  if (process.env.YOOKASSA_RECEIPTS_ENABLED?.trim() !== "true") {
    return undefined;
  }

  const rawVatCode = process.env.YOOKASSA_RECEIPT_VAT_CODE?.trim() ?? "";
  const vatCode = Number(rawVatCode);

  if (!Number.isInteger(vatCode) || vatCode < 1 || vatCode > 12) {
    throw new Error("YOOKASSA_RECEIPT_VAT_CODE must be an integer from 1 to 12 when receipts are enabled");
  }

  return vatCode;
}

function getYooKassaReceiptCustomer(input: Pick<CreatePaymentInput, "customerEmail">) {
  const vatCode = getReceiptVatCode();

  if (vatCode === undefined) {
    return undefined;
  }

  const email = input.customerEmail?.trim().toLowerCase() ?? "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("A customer email is required to send the YooKassa receipt");
  }

  return { email, vatCode };
}

function buildYooKassaReceipt(customer: ReturnType<typeof getYooKassaReceiptCustomer>, amount: number, targetTitle: string) {
  if (!customer) return undefined;
  return {
    customer: { email: customer.email },
    internet: true,
    items: [
      {
        amount: {
          currency: "RUB",
          value: formatStoredAmount(amount),
        },
        description: `Услуга размещения: ${targetTitle}`.slice(0, 128),
        payment_mode: "full_payment",
        payment_subject: "service",
        quantity: 1,
        vat_code: customer.vatCode,
      },
    ],
  };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getPaymentProviderName() {
  const provider = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();

  if (provider === "yookassa") {
    return "yookassa";
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PAYMENT_PROVIDER=yookassa is required in production");
  }

  return "mock" as const;
}

export function canForceSucceedYooKassaReturn() {
  // Kept for old consumers; a browser return is never proof of settlement.
  return false;
}

export function validatePaymentCreationPrerequisites(input: { customerEmail?: string }): void {
  if (getPaymentProviderName() !== "yookassa") return;
  if (!process.env.YOOKASSA_SHOP_ID?.trim() || !process.env.YOOKASSA_SECRET_KEY?.trim()) {
    throw new Error("YooKassa credentials are not configured");
  }
  getYooKassaReceiptCustomer(input);
}

export async function listPayments() {
  if (isSupabaseRestConfigured()) {
    return listStoredPayments();
  }

  return shouldAllowMockPayments() ? listMockPayments() : [];
}

export function getPayment(paymentId: string) {
  return shouldAllowMockPayments() ? listMockPayments().find((payment) => payment.id === paymentId) : undefined;
}

const YOOKASSA_REQUEST_BUDGET_MS = 35_000;
const YOOKASSA_MAX_RESPONSE_BYTES = 64 * 1024;
const YOOKASSA_MAX_ATTEMPTS = 3;

class YooKassaBoundaryError extends Error {}

const YOOKASSA_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rublesToKopecks(value: string) {
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(value)) {
    throw new YooKassaBoundaryError("YooKassa payment amount is invalid");
  }
  const [rubles, fraction = ""] = value.split(".");
  const kopecks = BigInt(rubles) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (kopecks <= BigInt(0) || kopecks > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new YooKassaBoundaryError("YooKassa payment amount is invalid");
  }
  return kopecks;
}

function storedAmountKopecks(amount: number) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new YooKassaBoundaryError("YooKassa stored payment amount is invalid");
  }
  return rublesToKopecks(String(amount));
}

function formatStoredAmount(amount: number) {
  const kopecks = storedAmountKopecks(amount);
  return `${kopecks / BigInt(100)}.${String(kopecks % BigInt(100)).padStart(2, "0")}`;
}

function validateStoredCheckout(payment: Payment, input: CreatePaymentInput, targetType: PaymentTargetType) {
  if (payment.provider !== "yookassa" || !YOOKASSA_ID_PATTERN.test(payment.id) || !input.userId ||
      payment.userId !== input.userId || !input.targetId || payment.targetId !== input.targetId || payment.targetType !== targetType) {
    throw new YooKassaBoundaryError("YooKassa stored payment does not match the checkout owner and target");
  }
  storedAmountKopecks(payment.amount);
}

function validateConfirmationUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\s\\]/.test(value)) {
    throw new YooKassaBoundaryError("YooKassa confirmation URL is invalid");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new YooKassaBoundaryError("YooKassa confirmation URL is invalid"); }
  // This is our hosted-checkout policy, not an exhaustive list of vendor/partner flows.
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["yoomoney.ru", "yookassa.ru"].includes(url.hostname)) {
    throw new YooKassaBoundaryError("YooKassa confirmation URL is not approved for hosted checkout");
  }
  return value;
}

function validateCaptureTime(value: unknown, status: YooKassaPaymentStatus) {
  if (typeof value !== "string" || value.length > 30 || status !== "succeeded") {
    throw new YooKassaBoundaryError("YooKassa capture time is invalid");
  }
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  const timestamp = Date.parse(value);
  if (!parts || parts[0].length !== value.length || !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString() !== `${parts[1]}.${(parts[2] ?? "").padEnd(3, "0").slice(0, 3)}Z`) {
    throw new YooKassaBoundaryError("YooKassa capture time is invalid");
  }
  const nanosPerMillisecond = BigInt(1_000_000);
  const captureNanos = BigInt(timestamp) * nanosPerMillisecond + BigInt((parts[2] ?? "").padEnd(9, "0").slice(3));
  if (captureNanos > BigInt(Date.now() + 5 * 60_000) * nanosPerMillisecond) {
    throw new YooKassaBoundaryError("YooKassa capture time is invalid");
  }
  // Keep full vendor precision. Missing captured_at is optional, not an invitation
  // to substitute order creation or verification-arrival time as settlement time.
  return value;
}

function validateYooKassaPayment(payload: unknown, payment: Payment, secretKey: string): YooKassaPaymentResponse {
  // Validate the consumed contract only; unused provider PII is neither retained nor trusted.
  // Source: https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml
  if (!isObject(payload) || typeof payload.id !== "string" || !YOOKASSA_ID_PATTERN.test(payload.id) ||
      (payment.providerPaymentId !== undefined && payload.id !== payment.providerPaymentId)) {
    throw new YooKassaBoundaryError("YooKassa payment ID does not match the local payment");
  }
  if (!isObject(payload.amount) || payload.amount.currency !== "RUB" || typeof payload.amount.value !== "string" ||
      !/^(?:0|[1-9]\d{0,13})\.\d{2}$/.test(payload.amount.value) ||
      rublesToKopecks(payload.amount.value) !== storedAmountKopecks(payment.amount)) {
    throw new YooKassaBoundaryError("YooKassa payment amount does not match the local payment");
  }
  const status = payload.status;
  if ((status !== "pending" && status !== "waiting_for_capture" && status !== "succeeded" && status !== "canceled") ||
      typeof payload.paid !== "boolean" || payload.paid !== (status === "succeeded" || status === "waiting_for_capture")) {
    throw new YooKassaBoundaryError("YooKassa payment status and paid flag are inconsistent");
  }
  if (typeof payload.test !== "boolean" || payload.test !== secretKey.startsWith("test_")) {
    throw new YooKassaBoundaryError("YooKassa payment mode does not match the configured merchant");
  }
  const capturedAt = payload.captured_at === undefined ? undefined : validateCaptureTime(payload.captured_at, status);
  let metadata: Record<string, string | null> | undefined;
  if (payload.metadata !== undefined) {
    if (!isObject(payload.metadata) || Object.keys(payload.metadata).length > 16 ||
        Object.entries(payload.metadata).some(([key, value]) => key.length > 32 ||
          (value !== null && (typeof value !== "string" || value.length > 512)))) {
      throw new YooKassaBoundaryError("YooKassa payment metadata is invalid");
    }
    const bindings = { localPaymentId: payment.id, targetId: payment.targetId, targetType: payment.targetType, tariffId: payment.tariffId };
    for (const [key, expected] of Object.entries(bindings)) {
      if (Object.hasOwn(payload.metadata, key) && payload.metadata[key] !== expected) {
        throw new YooKassaBoundaryError("YooKassa payment metadata does not match the local payment");
      }
    }
    metadata = payload.metadata as Record<string, string | null>;
  }
  let confirmation: YooKassaPaymentResponse["confirmation"];
  if (payload.confirmation !== undefined) {
    if (!isObject(payload.confirmation) || payload.confirmation.type !== "redirect") {
      throw new YooKassaBoundaryError("YooKassa confirmation type is invalid");
    }
    confirmation = { type: "redirect", confirmation_url: validateConfirmationUrl(payload.confirmation.confirmation_url) };
  }
  if (!confirmation && payment.confirmationUrl !== undefined) validateConfirmationUrl(payment.confirmationUrl);
  return { id: payload.id, amount: { value: payload.amount.value, currency: "RUB" }, status,
    paid: payload.paid, test: payload.test, capturedAt, metadata, confirmation };
}

type YooKassaRequestBudget = {
  attempts: number;
  controller: AbortController;
  expired: Promise<never>;
  start: () => void;
};

async function withYooKassaRequestBudget<T>(request: (budget: YooKassaRequestBudget) => Promise<T>) {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  // The deadline can expire between remote requests while local storage awaits.
  // The next remote operation still fails closed, without an unhandled rejection.
  void expired.catch(() => undefined);
  const budget: YooKassaRequestBudget = {
    attempts: 0, controller, expired,
    start: () => {
      deadline ??= setTimeout(() => controller.abort(new YooKassaBoundaryError("YooKassa request timed out")), YOOKASSA_REQUEST_BUDGET_MS);
    },
  };

  try {
    return await request(budget);
  } finally {
    clearTimeout(deadline);
  }
}

async function readYooKassaJson(response: Response, budget: YooKassaRequestBudget): Promise<unknown> {
  const tooLarge = () => new YooKassaBoundaryError("YooKassa response is too large");
  if (Number(response.headers.get("content-length")) > YOOKASSA_MAX_RESPONSE_BYTES) {
    budget.controller.abort(tooLarge());
    void response.body?.cancel().catch(() => undefined);
    throw budget.controller.signal.reason;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), budget.expired]);
      if (done) { complete = true; break; }
      bytes += value.byteLength;
      if (bytes > YOOKASSA_MAX_RESPONSE_BYTES) {
        budget.controller.abort(tooLarge());
        throw budget.controller.signal.reason;
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))) as unknown;
    } catch {
      if (!response.ok) return null;
      throw new YooKassaBoundaryError("YooKassa returned invalid JSON");
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function yooKassaHttpError(response: Response, payload: unknown) {
  const errorId = payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.id) ? payload.id : undefined;
  // Provider descriptions and transport error messages may contain sensitive data.
  return new YooKassaBoundaryError(`YooKassa request failed (HTTP ${response.status}${errorId ? `; error id ${errorId}` : ""})`);
}

async function fetchYooKassaJson(url: string, init: RequestInit, budget?: YooKassaRequestBudget): Promise<{ payload: unknown; response: Response }> {
  if (!budget) return withYooKassaRequestBudget((shared) => fetchYooKassaJson(url, init, shared));
  budget.start();

  for (let attempt = 1; attempt <= YOOKASSA_MAX_ATTEMPTS; attempt += 1) {
    budget.controller.signal.throwIfAborted();
    if (budget.attempts >= YOOKASSA_MAX_ATTEMPTS) throw new YooKassaBoundaryError("YooKassa request attempt budget exhausted");
    budget.attempts += 1;
    try {
      // One deadline covers headers, decoded body and backoff, not each attempt.
      // Source: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#canceling_a_request
      const response = await Promise.race([fetch(url, { ...init, signal: budget.controller.signal, redirect: "error" }), budget.expired]);
      const payload = await readYooKassaJson(response, budget);
      if (response.status < 500 || budget.attempts === YOOKASSA_MAX_ATTEMPTS) {
        if (!response.ok) throw yooKassaHttpError(response, payload);
        return { payload, response };
      }
    } catch (error) {
      if (error instanceof YooKassaBoundaryError) throw error;
      if (budget.controller.signal.aborted) throw budget.controller.signal.reason;
      if (budget.attempts === YOOKASSA_MAX_ATTEMPTS) throw new YooKassaBoundaryError("YooKassa request failed");
    }
    let backoff: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([new Promise<void>((resolve) => { backoff = setTimeout(resolve, attempt * 500); }), budget.expired]);
    } finally {
      clearTimeout(backoff);
    }
  }
  throw new YooKassaBoundaryError("YooKassa request failed");
}

async function fetchYooKassaPayment(payment: Payment, budget?: YooKassaRequestBudget) {
  const providerPaymentId = payment.providerPaymentId;
  if (typeof providerPaymentId !== "string" || !YOOKASSA_ID_PATTERN.test(providerPaymentId)) {
    throw new YooKassaBoundaryError("YooKassa stored payment ID is invalid");
  }
  storedAmountKopecks(payment.amount);
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("YooKassa credentials are not configured");
  }

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
  const { payload } = await fetchYooKassaJson(`https://api.yookassa.ru/v3/payments/${providerPaymentId}`, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  }, budget);

  return validateYooKassaPayment(payload, payment, secretKey);
}

function getPublicBaseUrl() {
  return getPublicSiteUrl();
}

function yookassaStatusToPaymentStatus(status: YooKassaPaymentStatus): Payment["status"] {
  if (status === "succeeded") {
    return "succeeded";
  }

  if (status === "canceled") {
    return "failed";
  }

  return "pending";
}

function applyYooKassaPaymentState(payment: Payment, yookassaPayment: YooKassaPaymentResponse) {
  payment.provider = "yookassa";
  payment.providerPaymentId = yookassaPayment.id;
  payment.status = yookassaStatusToPaymentStatus(yookassaPayment.status);
  payment.confirmationUrl = yookassaPayment.confirmation?.confirmation_url ?? payment.confirmationUrl;

  if (payment.status === "succeeded") {
    payment.paidAt = payment.paidAt ?? yookassaPayment.capturedAt;
  }

  return payment;
}

function createPendingPaymentResult(payment: Payment): PaymentResult {
  const financiallySucceeded = payment.status === "succeeded";
  const blocked = financiallySucceeded && payment.fulfillmentStatus === "blocked";
  return {
    payment,
    notification: {
      subject: payment.status === "refunded" ? "Оплата возвращена" : payment.status === "failed" ? "Оплата не завершена"
        : blocked ? "Размещение требует проверки" : financiallySucceeded ? "Оплата подтверждена" : "Оплата ожидает подтверждения",
      body: `${payment.targetTitle}: ${blocked ? "оплата подтверждена, но размещение не применено. Обратитесь в поддержку."
        : financiallySucceeded ? "размещение ожидает подтверждения сервера."
        : payment.status === "refunded" ? "платеж возвращен." : payment.status === "failed" ? "платеж не завершен."
        : "ЮKassa еще не подтвердила успешную оплату."}`,
    },
  };
}

function succeededPaymentResult(payment: Payment, nextStatus?: PaymentResult["nextStatus"]): PaymentResult {
  if (payment.status !== "succeeded" || payment.fulfillmentStatus !== "applied") return createPendingPaymentResult(payment);
  return {
    payment,
    ...(nextStatus ? { nextStatus } : {}),
    notification: {
      subject: "Оплата прошла",
      body: `${payment.targetTitle}: размещение подтверждено сервером.`,
    },
  };
}

async function applySucceededPaymentOnce(payment: Payment): Promise<PaymentResult> {
  if (payment.provider === "mock") {
    if (!shouldAllowMockPayments() || isSupabaseRestConfigured()) {
      throw new Error("Stored mock payment settlement is disabled; use the isolated in-memory demo");
    }
    // Explicitly synthetic, nonproduction, no database or financial writes.
    payment.status = "succeeded";
    payment.paidAt ??= new Date().toISOString();
    const nextStatus = payment.targetAppliedAt ? undefined : markPaymentTargetSucceeded(payment);
    payment.targetAppliedAt ??= new Date().toISOString();
    payment.fulfillmentStatus = "applied";
    payment.fulfillmentReason = undefined;
    return succeededPaymentResult(payment, nextStatus);
  }
  if (!canStorePayment(payment)) throw new Error("Stored payment is required before confirming payment");
  // Verified finance commits separately FIRST. Never manufacture a capture
  // anchor/target marker. The returned DB row may already be refunded/blocked.
  await updateStoredPayment(payment);
  if (payment.status !== "succeeded") return createPendingPaymentResult(payment);
  try {
    const fulfilled = await applyStoredPaymentFulfillment(payment);
    return succeededPaymentResult(payment, fulfilled.nextStatus);
  } catch {
    // A response can be lost after commit. Re-read durable truth; unresolved
    // financial success remains pending, never falsely failed or published.
    try {
      const stored = await getStoredPayment(payment.id);
      if (stored) Object.assign(payment, stored, { targetTitle: payment.targetTitle });
    } catch { /* A later verified webhook retries unresolved fulfillment. */ }
    return succeededPaymentResult(payment);
  }
}

async function applySucceededPayment(payment: Payment): Promise<PaymentResult> {
  const existing = pendingSucceededPaymentApplications.get(payment.id);

  if (existing) {
    const result = await existing;
    Object.assign(payment, result.payment);
    return { ...result, payment };
  }

  const applying = applySucceededPaymentOnce(payment).finally(() => {
    pendingSucceededPaymentApplications.delete(payment.id);
  });

  pendingSucceededPaymentApplications.set(payment.id, applying);

  return applying;
}

async function createYooKassaPaymentOnce(input: CreatePaymentInput, tariff: Tariff, budget: YooKassaRequestBudget) {
  if (!canStorePayment(input)) {
    throw new Error("Payment persistence is required before creating YooKassa payment");
  }

  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("YooKassa credentials are not configured");
  }

  const auth = Buffer.from(shopId + ":" + secretKey).toString("base64");
  const targetType = validatePaymentTargetTypeForTariff(tariff, input.targetType);
  const targetTitle = resolveTargetTitle(tariff, input.targetTitle);
  // Validate receipt prerequisites before creating the durable local operation.
  const receiptCustomer = getYooKassaReceiptCustomer(input);
  let activePayment = await findActiveStoredPaymentForTarget({
    targetId: input.targetId,
    targetType,
    userId: input.userId,
  });

  if (activePayment?.provider !== "yookassa") {
    activePayment = undefined;
  }

  if (activePayment) validateStoredCheckout(activePayment, input, targetType);

  if (activePayment?.providerPaymentId) {
    const yookassaPayment = await fetchYooKassaPayment(activePayment, budget);

    applyYooKassaPaymentState(activePayment, yookassaPayment);

    if (activePayment.status === "succeeded") {
      await applySucceededPayment(activePayment);
      return activePayment;
    }

    await updateStoredPayment(activePayment);

    if (activePayment.confirmationUrl) {
      return activePayment;
    }
  }

  if (!activePayment) {
    storedAmountKopecks(tariff.price);
    const pendingPayment: Payment = {
      id: createPaymentId(),
      userId: input.userId,
      targetType,
      targetId: input.targetId,
      targetTitle,
      tariffId: tariff.id,
      amount: tariff.price,
      status: "created",
      provider: "yookassa",
      createdAt: todayIsoDate(),
    };

    try {
      const storedPayment = await createStoredPayment({
        amount: pendingPayment.amount,
        id: pendingPayment.id,
        provider: pendingPayment.provider,
        status: pendingPayment.status,
        targetId: pendingPayment.targetId,
        targetTitle: pendingPayment.targetTitle,
        targetType: pendingPayment.targetType,
        tariff,
        userId: input.userId,
      });

      if (!storedPayment) {
        throw new Error("YooKassa payment could not be persisted locally");
      }
      activePayment = { ...storedPayment, targetTitle };
    } catch (error) {
      // The database-level unique index may have been won by another server
      // instance. Reuse its stable local idempotence key instead of starting a
      // second payment operation for the same publication.
      const concurrentPayment = await findActiveStoredPaymentForTarget({
        targetId: input.targetId,
        targetType,
        userId: input.userId,
      });

      if (!concurrentPayment || concurrentPayment.provider !== "yookassa") {
        throw error;
      }

      activePayment = concurrentPayment;
    }
  }

  validateStoredCheckout(activePayment, input, targetType);
  const localPaymentId = activePayment.id;
  const receipt = buildYooKassaReceipt(receiptCustomer, activePayment.amount, targetTitle);
  const returnUrl = getPublicBaseUrl() + "/oplata/" + localPaymentId;
  const { payload: rawPayload } = await fetchYooKassaJson("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/json",
      "Idempotence-Key": localPaymentId,
    },
    body: JSON.stringify({
      amount: {
        value: formatStoredAmount(activePayment.amount),
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: returnUrl,
      },
      description: targetTitle.slice(0, 128),
      ...(receipt ? { receipt } : {}),
      metadata: {
        localPaymentId,
        targetId: activePayment.targetId,
        targetType: activePayment.targetType,
        tariffId: activePayment.tariffId,
      },
    }),
  }, budget);

  const payment = activePayment;
  const payload = validateYooKassaPayment(rawPayload, payment, secretKey);
  applyYooKassaPaymentState(payment, payload);

  if (payment.status === "succeeded") {
    await applySucceededPayment(payment);
  } else {
    await updateStoredPayment(payment);
  }

  return payment;
}
async function createYooKassaPayment(input: CreatePaymentInput, tariff: Tariff) {
  const targetType = validatePaymentTargetTypeForTariff(tariff, input.targetType);
  const idempotencyKey =
    input.targetId && input.userId ? `${input.userId}:${targetType}:${input.targetId}:${tariff.id}` : `payment:${createPaymentId()}`;
  const existing = pendingYooKassaPaymentCreations.get(idempotencyKey);

  if (existing) {
    return existing;
  }

  const creating = withYooKassaRequestBudget((budget) => createYooKassaPaymentOnce({ ...input, targetType }, tariff, budget)).finally(() => {
    pendingYooKassaPaymentCreations.delete(idempotencyKey);
  });

  pendingYooKassaPaymentCreations.set(idempotencyKey, creating);

  return creating;
}

export async function createPayment(input: CreatePaymentInput) {
  const tariff = await getActiveStoredTariffById(input.tariffId);

  if (!tariff) {
    throw new Error("Tariff not found or inactive");
  }

  const provider = getPaymentProviderName();

  if (provider === "yookassa") {
    return createYooKassaPayment(input, tariff);
  }

  const payment: Payment = {
    id: canStorePayment(input) ? createPaymentId() : createMockPaymentId(),
    targetType: validatePaymentTargetTypeForTariff(tariff, input.targetType),
    targetId: input.targetId,
    targetTitle: resolveTargetTitle(tariff, input.targetTitle),
    tariffId: tariff.id,
    amount: tariff.price,
    status: "created",
    provider,
    createdAt: todayIsoDate(),
  };

  if (canStorePayment(input)) {
    await createStoredPayment({
      amount: payment.amount,
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      targetId: payment.targetId,
      targetTitle: payment.targetTitle,
      targetType: payment.targetType,
      tariff,
      userId: input.userId,
    });
  } else if (shouldAllowMockPayments()) {
    listMockPayments().unshift(payment);
  } else {
    throw new Error("Payment persistence is required");
  }

  return payment;
}

async function resolvePaymentForConfirmation(paymentId: string) {
  return (await getStoredPayment(paymentId)) ?? (await findStoredPaymentByProvider(paymentId)) ?? (shouldAllowMockPayments() ? getPayment(paymentId) : undefined);
}

export async function confirmPayment(paymentOrId: Payment | string, options?: ConfirmPaymentOptions): Promise<PaymentResult> {
  void options; // Backward-compatible argument; never trust a browser success flag.
  const payment = typeof paymentOrId === "string" ? await resolvePaymentForConfirmation(paymentOrId) : paymentOrId;

  if (!payment) {
    throw new Error("Payment not found");
  }

  if (payment.provider === "yookassa") {
    if (!payment.providerPaymentId) {
      throw new Error("YooKassa payment id is missing");
    }

    const yookassaPayment = await fetchYooKassaPayment(payment);
    applyYooKassaPaymentState(payment, yookassaPayment);

    if (payment.status !== "succeeded") {
      const persisted = await updateStoredPayment(payment);
      if (persisted.status === "succeeded") {
        return applySucceededPayment(persisted);
      }
      return createPendingPaymentResult(persisted);
    }

    return applySucceededPayment(payment);
  }

  if (!shouldAllowMockPayments()) {
    throw new Error("Mock payment confirmation is disabled");
  }

  return applySucceededPayment(payment);
}

async function findPaymentByYooKassaObject(yookassaPayment: YooKassaPaymentResponse) {
  const localPaymentId = yookassaPayment.metadata?.localPaymentId;
  const storedPayment = await findStoredPaymentByProvider(yookassaPayment.id);

  if (storedPayment) {
    return storedPayment;
  }

  return shouldAllowMockPayments() ? listMockPayments().find((payment) => payment.id === localPaymentId || payment.providerPaymentId === yookassaPayment.id) : undefined;
}

export async function processYooKassaNotification(payload: YooKassaNotificationPayload) {
  const yookassaPayment = payload.object;

  if (!payload.event?.startsWith("payment.") || !yookassaPayment?.id) {
    return { processed: false, reason: "unsupported_notification" as const };
  }

  const payment = await findPaymentByYooKassaObject(yookassaPayment);

  if (!payment) {
    return { processed: false, reason: "payment_not_found" as const };
  }

  // Notification metadata is untrusted. Never apply a provider payment to a different local payment.
  if (payment.provider !== "yookassa" || payment.providerPaymentId !== yookassaPayment.id) {
    return { processed: false, reason: "payment_mismatch" as const };
  }

  const verifiedYooKassaPayment = await fetchYooKassaPayment(payment);

  applyYooKassaPaymentState(payment, verifiedYooKassaPayment);

  if (payment.status !== "succeeded") {
    const persisted = await updateStoredPayment(payment);
    if (persisted.status === "succeeded") {
      return { processed: true, result: await applySucceededPayment(persisted) };
    }
    return { processed: true, result: createPendingPaymentResult(persisted) };
  }

  return { processed: true, result: await applySucceededPayment(payment) };
}
