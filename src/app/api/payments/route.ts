import { NextResponse } from "next/server";
import { getStoredListingForUser, markStoredListingPendingPaymentForUser } from "@/lib/listing-store";
import { createPayment, listPayments } from "@/lib/payment-provider";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isUuid } from "@/lib/supabase-rest";
import type { Payment } from "@/lib/types";

type CreatePaymentBody = {
  tariffId?: string;
  targetId?: string;
  targetType?: Payment["targetType"];
  targetTitle?: string;
};

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const payments = await listPayments();

  return NextResponse.json({ payments });
}

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы создать платеж" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreatePaymentBody | null;

  if (!body?.tariffId) {
    return NextResponse.json({ error: "tariffId is required" }, { status: 400 });
  }

  try {
    let targetTitle = body.targetTitle;

    if (body.targetType === "listing") {
      if (!body.targetId || !isUuid(body.targetId)) {
        return NextResponse.json({ error: "Сначала сохраните объявление, затем оплатите публикацию" }, { status: 400 });
      }

      const listing = await getStoredListingForUser(body.targetId, auth.user.id);

      if (!listing) {
        return NextResponse.json({ error: "Объявление не найдено или уже удалено" }, { status: 404 });
      }

      if (listing.status === "published") {
        return NextResponse.json({ error: "Объявление уже опубликовано" }, { status: 400 });
      }

      if (listing.status === "archived" || listing.status === "sold" || listing.status === "expired" || listing.status === "rejected") {
        return NextResponse.json({ error: "Это объявление снято с публикации. Создайте новое или восстановите доступное объявление." }, { status: 400 });
      }

      if (listing.status === "draft") {
        const updated = await markStoredListingPendingPaymentForUser(body.targetId, auth.user.id);

        if (!updated) {
          return NextResponse.json({ error: "Не удалось подготовить объявление к оплате. Обновите страницу и попробуйте снова." }, { status: 409 });
        }
      }

      targetTitle = listing.title;
    }

    const payment = await createPayment({
      tariffId: body.tariffId,
      targetId: body.targetId,
      targetType: body.targetType,
      targetTitle,
      userId: auth.user.id,
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment creation failed" }, { status: 400 });
  }
}
