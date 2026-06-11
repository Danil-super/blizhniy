import { NextResponse } from "next/server";
import { listStoredFairApplicationsForUser } from "@/lib/fair-application-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы открыть заявки" }, { status: 401 });
  }

  const applications = await listStoredFairApplicationsForUser(auth.user.id);

  return NextResponse.json({ applications });
}
