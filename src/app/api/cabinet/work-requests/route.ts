import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isUuid } from "@/lib/supabase-rest";
import { deleteStoredWorkRequestForUser } from "@/lib/work-request-store";

type DeleteWorkRequestBody = {
  id?: string;
};

export async function DELETE(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы удалить заказ" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as DeleteWorkRequestBody | null;
  const requestId = body?.id?.trim();

  if (!requestId || !isUuid(requestId)) {
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  }

  const deleted = await deleteStoredWorkRequestForUser(requestId, auth.user.id);

  return NextResponse.json({ deleted });
}
