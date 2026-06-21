import { NextResponse } from "next/server";
import {
  createStoredBookingRequest,
  listActiveBookingRequestsForListing,
  updateStoredBookingRequestStatus,
} from "@/lib/booking-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured, isUuid } from "@/lib/supabase-rest";

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

type CreateBookingBody = {
  endDate?: string;
  guests?: number;
  startDate?: string;
};

type UpdateBookingBody = {
  requestId?: string;
  status?: "accepted" | "declined";
};

function cleanDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : undefined;
}

function cleanGuests(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

export async function GET(_request: Request, context: RouteContext) {
  const { listingId } = await context.params;

  if (!isUuid(listingId)) {
    return NextResponse.json({ requests: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!isSupabaseServerConfigured() || !isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ requests: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const requests = await listActiveBookingRequestsForListing(listingId);

  return NextResponse.json({ requests }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSupabaseServerConfigured() || !isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server booking is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы отправить заявку на бронь" }, { status: 401 });
  }

  const { listingId } = await context.params;

  if (!isUuid(listingId)) {
    return NextResponse.json({ error: "Некорректное объявление для бронирования" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as CreateBookingBody | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const booking = await createStoredBookingRequest({
      endDate: cleanDate(body.endDate),
      guests: cleanGuests(body.guests),
      listingId,
      startDate: cleanDate(body.startDate),
      userId: auth.user.id,
    });

    return NextResponse.json({ booking }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось отправить заявку на бронь" }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSupabaseServerConfigured() || !isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server booking is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите, чтобы ответить на заявку" }, { status: 401 });
  }

  const { listingId } = await context.params;
  const body = (await request.json().catch(() => null)) as UpdateBookingBody | null;

  if (!isUuid(listingId) || !body?.requestId || (body.status !== "accepted" && body.status !== "declined")) {
    return NextResponse.json({ error: "Некорректные параметры заявки" }, { status: 400 });
  }

  try {
    const booking = await updateStoredBookingRequestStatus({
      requestId: body.requestId,
      status: body.status,
      userId: auth.user.id,
    });

    if (!booking || booking.listingId !== listingId) {
      return NextResponse.json({ error: "Заявка не найдена или недоступна" }, { status: 404 });
    }

    return NextResponse.json({ booking }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось ответить на заявку" }, { status: 400 });
  }
}
