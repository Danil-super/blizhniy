// Pure provider response contract. No database, credentials, HTTP or fulfillment.
export type YooKassaPaymentStatus = "pending" | "waiting_for_capture" | "succeeded" | "canceled";
export type YooKassaPaymentResponse = {
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

export type ExpectedYooKassaPayment = {
  id: string;
  targetId?: string;
  targetType: string;
  tariffId: string;
  amount: string;
  providerPaymentId?: string;
  confirmationUrl?: string;
  isTest: boolean;
  shopId?: string;
  requireMetadata?: boolean;
};
export class YooKassaBoundaryError extends Error {}
const YOOKASSA_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type PrimaryYooKassaBinding = Omit<ExpectedYooKassaPayment, 'shopId' | 'targetId' | 'requireMetadata'> & {
  shopId: string;
  targetId: string;
};
/** New PostgreSQL intents have complete provenance; no historical missing-binding exception. */
export function assertPrimaryYooKassaBinding(expected: PrimaryYooKassaBinding, now: number): void {
  if (!Number.isFinite(now) || typeof expected.id !== 'string' || !YOOKASSA_ID_PATTERN.test(expected.id) ||
      typeof expected.targetId !== 'string' || !YOOKASSA_ID_PATTERN.test(expected.targetId) ||
      typeof expected.shopId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(expected.shopId) || typeof expected.isTest !== 'boolean' ||
      typeof expected.amount !== 'string' || !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(expected.amount) ||
      typeof expected.tariffId !== 'string' || expected.tariffId.length > 100 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(expected.tariffId) ||
      !['listing', 'vacancy', 'workRequest', 'specialist', 'application', 'fair_application', 'ad_marquee'].includes(expected.targetType) ||
      (expected.providerPaymentId !== undefined && (typeof expected.providerPaymentId !== 'string' || !YOOKASSA_ID_PATTERN.test(expected.providerPaymentId)))) {
    throw new YooKassaBoundaryError('YooKassa original payment binding is invalid');
  }
  rublesToKopecks(expected.amount);
}
export function validatePrimaryYooKassaPayment(payload: unknown, expected: PrimaryYooKassaBinding, now: number): YooKassaPaymentResponse {
  assertPrimaryYooKassaBinding(expected,now);
  const verified = validateYooKassaPaymentObject(payload,{...expected,requireMetadata:true},now);
  // Strict validation above verified each binding. Do not retain unrelated metadata.
  return {...verified, metadata: {
    localPaymentId: expected.id, targetId: expected.targetId,
    targetType: expected.targetType, tariffId: expected.tariffId,
  }};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rublesToKopecks(value: string) {
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

function validateCaptureTime(value: unknown, status: YooKassaPaymentStatus, now: number) {
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
  if (captureNanos > BigInt(now + 5 * 60_000) * nanosPerMillisecond) {
    throw new YooKassaBoundaryError("YooKassa capture time is invalid");
  }
  // Keep full vendor precision. Missing captured_at is optional, not an invitation
  // to substitute order creation or verification-arrival time as settlement time.
  return value;
}

export function validateYooKassaPaymentObject(payload: unknown, expected: ExpectedYooKassaPayment, now: number): YooKassaPaymentResponse {
  // Validate the consumed contract only; unused provider PII is neither retained nor trusted.
  // Source: https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml
  if (!isObject(payload) || typeof payload.id !== "string" || !YOOKASSA_ID_PATTERN.test(payload.id) ||
      (expected.providerPaymentId !== undefined && payload.id !== expected.providerPaymentId)) {
    throw new YooKassaBoundaryError("YooKassa payment ID does not match the local payment");
  }
  if (!isObject(payload.amount) || payload.amount.currency !== "RUB" || typeof payload.amount.value !== "string" ||
      !/^(?:0|[1-9]\d{0,13})\.\d{2}$/.test(payload.amount.value) ||
      rublesToKopecks(payload.amount.value) !== rublesToKopecks(expected.amount)) {
    throw new YooKassaBoundaryError("YooKassa payment amount does not match the local payment");
  }
  const status = payload.status;
  if ((status !== "pending" && status !== "waiting_for_capture" && status !== "succeeded" && status !== "canceled") ||
      typeof payload.paid !== "boolean" || payload.paid !== (status === "succeeded" || status === "waiting_for_capture")) {
    throw new YooKassaBoundaryError("YooKassa payment status and paid flag are inconsistent");
  }
  if (typeof payload.test !== "boolean" || payload.test !== expected.isTest) {
    throw new YooKassaBoundaryError("YooKassa payment mode does not match the configured merchant");
  }
  if (expected.shopId !== undefined && (!isObject(payload.recipient) || payload.recipient.account_id !== expected.shopId)) {
    throw new YooKassaBoundaryError("YooKassa payment merchant does not match the original shop");
  }
  if (expected.requireMetadata && !isObject(payload.metadata)) {
    throw new YooKassaBoundaryError("YooKassa payment metadata is required");
  }
  const capturedAt = payload.captured_at === undefined ? undefined : validateCaptureTime(payload.captured_at, status, now);
  let metadata: Record<string, string | null> | undefined;
  if (payload.metadata !== undefined) {
    if (!isObject(payload.metadata) || Object.keys(payload.metadata).length > 16 ||
        Object.entries(payload.metadata).some(([key, value]) => key.length > 32 ||
          (value !== null && (typeof value !== "string" || value.length > 512)))) {
      throw new YooKassaBoundaryError("YooKassa payment metadata is invalid");
    }
    const bindings = { localPaymentId: expected.id, targetId: expected.targetId, targetType: expected.targetType, tariffId: expected.tariffId };
    for (const [key, boundValue] of Object.entries(bindings)) {
      if ((expected.requireMetadata || Object.hasOwn(payload.metadata, key)) && payload.metadata[key] !== boundValue) {
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
  if (!confirmation && expected.confirmationUrl !== undefined) validateConfirmationUrl(expected.confirmationUrl);
  return { id: payload.id, amount: { value: payload.amount.value, currency: "RUB" }, status,
    paid: payload.paid, test: payload.test, capturedAt, metadata, confirmation };
}
