import { NextResponse } from "next/server";
import { getPayment, confirmPayment } from "@/lib/payment-provider";
import { getStoredPayment } from "@/lib/payment-store";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;

  try {
    if (isSupabaseServerConfigured()) {
      const auth = await getAuthenticatedRequestUser(request);

      if (!auth) {
        return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы подтвердить платеж" }, { status: 401 });
      }

      const payment = (await getStoredPayment(paymentId)) ?? getPayment(paymentId);
      const isAdmin = await isAdminRequest(request);

      if (payment?.userId && payment.userId !== auth.user.id && !isAdmin) {
        return NextResponse.json({ error: "Платеж принадлежит другому пользователю" }, { status: 403 });
      }
    }

    const result = await confirmPayment(paymentId);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment confirmation failed" }, { status: 404 });
  }
}
