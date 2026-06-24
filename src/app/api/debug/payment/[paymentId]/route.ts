import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/server-auth";
import { getSupabaseRestConfig, isSupabaseRestConfigured, supabaseRest } from "@/lib/supabase-rest";

type PaymentDebugRow = {
  amount: number | string;
  created_at: string;
  id: string;
  provider: string;
  provider_payment_id?: string | null;
  status: string;
  target_id: string;
  target_type: string;
  user_id?: string | null;
};

export async function GET(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { paymentId } = await params;
  const { key, supabaseUrl } = getSupabaseRestConfig();

  if (!isSupabaseRestConfigured()) {
    return NextResponse.json({ configured: false, error: "Supabase REST is not configured" }, { status: 503 });
  }

  try {
    const rows = await supabaseRest<PaymentDebugRow[]>(`/rest/v1/payments?select=*&id=eq.${encodeURIComponent(paymentId)}&limit=1`);

    return NextResponse.json({
      configured: true,
      paymentId,
      found: Boolean(rows[0]),
      row: rows[0] ?? null,
      supabaseHost: supabaseUrl ? new URL(supabaseUrl).host : null,
      serviceRoleConfigured: Boolean(key),
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "Debug lookup failed",
        paymentId,
        supabaseHost: supabaseUrl ? new URL(supabaseUrl).host : null,
      },
      { status: 500 },
    );
  }
}
