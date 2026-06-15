import { NextResponse } from "next/server";
import { listPayments } from "@/lib/payment-provider";
import { isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";
import { getStoredTariffs, resetStoredTariffs, updateTariff } from "@/lib/tariff-store";

type UpdateTariffBody = {
  active?: boolean;
  durationDays?: number | null;
  id?: string;
  name?: string;
  price?: number;
};

async function requireAdmin(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  return null;
}

export async function GET(request: Request) {
  const denied = await requireAdmin(request);

  if (denied) {
    return denied;
  }

  const [tariffs, payments] = await Promise.all([getStoredTariffs(), listPayments()]);

  return NextResponse.json({ payments, tariffs });
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);

  if (denied) {
    return denied;
  }

  const body = (await request.json().catch(() => null)) as UpdateTariffBody | null;
  const id = body?.id?.trim();
  const name = body?.name?.trim();
  const price = Number(body?.price);
  const durationDays = body?.durationDays ?? null;

  if (!id || !name || Number.isNaN(price) || price < 0) {
    return NextResponse.json({ error: "Invalid tariff payload" }, { status: 400 });
  }

  if (durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 0)) {
    return NextResponse.json({ error: "Invalid tariff duration" }, { status: 400 });
  }

  await updateTariff(id, {
    active: Boolean(body?.active),
    durationDays,
    name,
    price,
  });

  const tariffs = await getStoredTariffs();

  return NextResponse.json({ tariffs });
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);

  if (denied) {
    return denied;
  }

  const body = (await request.json().catch(() => null)) as { action?: string } | null;

  if (body?.action !== "reset") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  await resetStoredTariffs();
  const tariffs = await getStoredTariffs();

  return NextResponse.json({ tariffs });
}
