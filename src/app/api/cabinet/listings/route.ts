import { NextResponse } from "next/server";
import { archiveStoredListingForUser, listStoredListingsForUser } from "@/lib/listing-store";
import { confirmPayment } from "@/lib/payment-provider";
import { listStoredPaymentsForUser, markStoredPaymentTargetSucceeded } from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";

async function syncPendingListingPayments(userId: string) {
  const payments = await listStoredPaymentsForUser(userId);
  const pendingListingPayments = payments.filter(
    (payment) => payment.targetType === "listing" && payment.provider === "yookassa" && (payment.status === "created" || payment.status === "pending"),
  );
  const succeededListingPayments = payments.filter((payment) => payment.targetType === "listing" && payment.status === "succeeded");

  await Promise.allSettled([
    ...pendingListingPayments.map((payment) => confirmPayment(payment)),
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

  return NextResponse.json({ listings });
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

  return NextResponse.json({ ok: true });
}
