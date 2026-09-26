import { NextResponse } from "next/server";
import { isSupabaseRestConfigured, supabaseRest } from "@/lib/supabase-rest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  if (!isSupabaseRestConfigured()) {
    return NextResponse.json({ ok: false, service: "blizhniy" }, { status: 503, headers });
  }

  try {
    // The table may be empty; a successful response still proves the DB is reachable
    // and the server credentials can query the application schema.
    await supabaseRest<unknown[]>("/rest/v1/categories?select=id&limit=1", {
      attempts: 1,
      timeoutMs: 3000,
    });
    return NextResponse.json({ ok: true, service: "blizhniy" }, { headers });
  } catch {
    return NextResponse.json({ ok: false, service: "blizhniy" }, { status: 503, headers });
  }
}
