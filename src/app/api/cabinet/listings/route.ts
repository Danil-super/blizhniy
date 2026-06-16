import { NextResponse } from "next/server";
import { archiveStoredListingForUser, listStoredListingsForUser } from "@/lib/listing-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы открыть объявления" }, { status: 401 });
  }

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
