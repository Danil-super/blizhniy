import { NextResponse } from "next/server";
import { confirmPayment } from "@/lib/payment-provider";
import { isAuthenticatedRequest, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  if (isSupabaseServerConfigured() && !(await isAuthenticatedRequest(request))) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы подтвердить платеж" }, { status: 401 });
  }

  const { paymentId } = await params;

  try {
    const result = await confirmPayment(paymentId);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment confirmation failed" }, { status: 404 });
  }
}
