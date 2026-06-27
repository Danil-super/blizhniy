import { isSupabaseRestConfigured } from "@/lib/supabase-rest";

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

export function shouldShowFallbackContent() {
  if (isProductionRuntime()) {
    return false;
  }

  if (process.env.ENABLE_DEMO_CONTENT === "true") {
    return true;
  }

  return !isSupabaseRestConfigured();
}

export function shouldAllowMockPayments() {
  return !isProductionRuntime() && process.env.PAYMENT_PROVIDER !== "yookassa";
}
