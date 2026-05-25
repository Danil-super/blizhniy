import { NextResponse } from "next/server";
import { confirmMockPayment } from "@/lib/payment-provider";

export async function POST(_request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;

  try {
    const result = confirmMockPayment(paymentId);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment confirmation failed" }, { status: 404 });
  }
}
