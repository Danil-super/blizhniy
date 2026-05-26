import { NextResponse } from "next/server";
import { createPayment, listPayments } from "@/lib/payment-provider";
import type { Payment } from "@/lib/types";

type CreatePaymentBody = {
  tariffId?: string;
  targetId?: string;
  targetType?: Payment["targetType"];
  targetTitle?: string;
};

export async function GET() {
  return NextResponse.json({ payments: listPayments() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CreatePaymentBody | null;

  if (!body?.tariffId) {
    return NextResponse.json({ error: "tariffId is required" }, { status: 400 });
  }

  try {
    const payment = createPayment({
      tariffId: body.tariffId,
      targetId: body.targetId,
      targetType: body.targetType,
      targetTitle: body.targetTitle,
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment creation failed" }, { status: 400 });
  }
}
