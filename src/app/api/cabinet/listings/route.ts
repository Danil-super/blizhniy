import { NextResponse } from "next/server";
import { listStoredListingsForUser } from "@/lib/listing-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы открыть объявления" }, { status: 401 });
  }

  const listings = await listStoredListingsForUser(auth.user.id);

  return NextResponse.json({ listings });
}
