import { NextResponse } from "next/server";
import { listStoredNotificationsForUser, markStoredNotificationsRead } from "@/lib/notification-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите, чтобы открыть уведомления" }, { status: 401 });
  }

  const notifications = await listStoredNotificationsForUser(auth.user.id);

  return NextResponse.json({ notifications }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите, чтобы изменить уведомления" }, { status: 401 });
  }

  const notifications = await markStoredNotificationsRead(auth.user.id);

  return NextResponse.json({ notifications });
}
