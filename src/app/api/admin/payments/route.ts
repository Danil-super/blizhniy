import { NextResponse } from "next/server";
import { listStoredPayments } from "@/lib/payment-store";
import { isAdminRequest, isDemoAdminBypassEnabled } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(isDemoAdminBypassEnabled() || (await isAdminRequest(request)))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    return NextResponse.json({ payments: await listStoredPayments() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load payments" }, { status: 500 });
  }
}
