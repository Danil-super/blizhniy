import { NextResponse } from "next/server";
import { updateStoredBookingRequestStatus } from "@/lib/booking-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured, isUuid } from "@/lib/supabase-rest";

type UpdateBookingBody = {
  requestId?: string;
  status?: "accepted" | "declined";
};

export async function PATCH(request: Request) {
  if (!isSupabaseServerConfigured() || !isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server booking is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите, чтобы ответить на заявку" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as UpdateBookingBody | null;

  if (!body?.requestId || !isUuid(body.requestId) || (body.status !== "accepted" && body.status !== "declined")) {
    return NextResponse.json({ error: "Некорректные параметры заявки" }, { status: 400 });
  }

  try {
    const booking = await updateStoredBookingRequestStatus({
      requestId: body.requestId,
      status: body.status,
      userId: auth.user.id,
    });

    if (!booking) {
      return NextResponse.json({ error: "Заявка не найдена или недоступна" }, { status: 404 });
    }

    return NextResponse.json({ booking }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось ответить на заявку" }, { status: 400 });
  }
}
