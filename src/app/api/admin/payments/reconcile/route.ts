import { NextResponse } from "next/server";
import { confirmPayment } from "@/lib/payment-provider";
import { listStoredPaymentReconciliationCandidateIds } from "@/lib/payment-store";
import { isAdminRequest } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";

export const dynamic = "force-dynamic";

// Manual recovery for webhook outages. Every candidate is checked through
// YooKassa GET before the transactional fulfillment RPC can be called.
export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server storage is not configured" }, { status: 503 });
  }

  try {
    const ids = await listStoredPaymentReconciliationCandidateIds();
    let succeeded = 0;
    let pending = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      try {
        const result = await confirmPayment(id);
        if (result.payment.status === "succeeded") succeeded += 1;
        else pending += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Payment reconciliation failed";
        failures.push({ id, error: message });
        console.error("Payment reconciliation failed", { id, error });
      }
    }

    return NextResponse.json({ checked: ids.length, succeeded, pending, failures }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment reconciliation failed" }, { status: 500 });
  }
}
