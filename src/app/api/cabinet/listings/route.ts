import { NextResponse } from "next/server";
import {
  archiveStoredListingForUser,
  listStoredListingsForUser,
  markStoredListingSoldForUser,
  restoreStoredListingForUser,
} from "@/lib/listing-store";
import { confirmPayment } from "@/lib/payment-provider";
import { listStoredPaymentsForUser, markStoredPaymentTargetSucceeded, updateStoredPayment } from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import type { Payment } from "@/lib/types";

function isTestYooKassaMode() {
  return process.env.YOOKASSA_SECRET_KEY?.trim().startsWith("test_") ?? false;
}

async function forceSucceededTestPayment(payment: Payment) {
  const paidPayment: Payment = {
    ...payment,
    paidAt: payment.paidAt ?? new Date().toISOString().slice(0, 10),
    status: "succeeded",
  };

  await markStoredPaymentTargetSucceeded(paidPayment);
  await updateStoredPayment(paidPayment);
}

async function syncPendingListingPayments(userId: string) {
  const payments = await listStoredPaymentsForUser(userId);
  const pendingListingPayments = payments.filter(
    (payment) => payment.targetType === "listing" && payment.provider === "yookassa" && (payment.status === "created" || payment.status === "pending"),
  );
  const succeededListingPayments = payments.filter((payment) => payment.targetType === "listing" && payment.status === "succeeded");

  await Promise.allSettled([
    ...pendingListingPayments.map(async (payment) => {
      const result = await confirmPayment(payment, { trustSuccessfulReturn: true });

      if (isTestYooKassaMode() && result.payment.status !== "succeeded") {
        await forceSucceededTestPayment(result.payment);
      }
    }),
    ...succeededListingPayments.map((payment) => markStoredPaymentTargetSucceeded(payment)),
  ]);
}

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы открыть объявления" }, { status: 401 });
  }

  await syncPendingListingPayments(auth.user.id);
  const listings = await listStoredListingsForUser(auth.user.id);

  return NextResponse.json({ listings }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы удалить объявление" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as { id?: string } | null;
  const listingId = payload?.id?.trim();

  if (!listingId) {
    return NextResponse.json({ error: "listing id is required" }, { status: 400 });
  }

  const archived = await archiveStoredListingForUser(listingId, auth.user.id);

  if (!archived) {
    return NextResponse.json({ error: "Объявление не найдено или уже удалено" }, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы изменить объявление" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as { action?: string; id?: string } | null;
  const listingId = payload?.id?.trim();
  const action = payload?.action?.trim();

  if (!listingId) {
    return NextResponse.json({ error: "listing id is required" }, { status: 400 });
  }

  if (action === "sold") {
    const updated = await markStoredListingSoldForUser(listingId, auth.user.id);

    if (!updated) {
      return NextResponse.json({ error: "Объявление не найдено или уже снято с публикации" }, { status: 404 });
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "restore") {
    const updated = await restoreStoredListingForUser(listingId, auth.user.id);

    if (!updated) {
      return NextResponse.json({ error: "Объявление не найдено или его нужно оплатить перед публикацией" }, { status: 404 });
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ error: "Unsupported listing action" }, { status: 400 });
}
