import { NextResponse } from "next/server";
import { isSupabaseRestConfigured, supabaseRest } from "@/lib/supabase-rest";
import { readProductionAuthConfig } from "@/lib/production-auth-config";
import { getProductionAccountDatabase } from "@/lib/production-auth-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = readProductionAuthConfig();
    if (config) {
      // Includes pool verification; the response never exposes DB details or falls back.
      // Outstanding reads retain the pool's connection/statement timeouts, not cancellation.
      const probe = async () => {
        const { db } = await getProductionAccountDatabase(config);
        const result = await db.query("select id from app.categories limit 1");
        if (!Array.isArray(result.rows)) throw new Error("Unexpected database response");
      };
      await Promise.race([
        probe(),
        new Promise<never>((resolve, reject) => {
          deadline = setTimeout(() => reject(new Error("Database readiness timeout")), 3000);
        }),
      ]);
      return NextResponse.json({ ok: true, service: "blizhniy" }, { headers });
    }
    if (!isSupabaseRestConfigured()) {
      return NextResponse.json({ ok: false, service: "blizhniy" }, { status: 503, headers });
    }
    // The table may be empty; a successful response still proves the DB is reachable
    // and the server credentials can query the application schema.
    const categories = await supabaseRest<unknown>("/rest/v1/categories?select=id&limit=1", {
      attempts: 1,
      timeoutMs: 3000,
    });

    if (!Array.isArray(categories)) {
      throw new Error("Unexpected database response");
    }

    return NextResponse.json({ ok: true, service: "blizhniy" }, { headers });
  } catch {
    return NextResponse.json({ ok: false, service: "blizhniy" }, { status: 503, headers });
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
}
