import { NextResponse } from "next/server";
import { createAdMarqueePlacement, listAdMarqueePlacementsForUser } from "@/lib/ad-marquee-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";

type CreateAdMarqueeBody = {
  href?: string;
  text?: string;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите, чтобы посмотреть заявки бегущей строки" }, { status: 401 });
  }

  try {
    return NextResponse.json({ placements: await listAdMarqueePlacementsForUser(auth.user.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить заявки" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите, чтобы отправить текст на модерацию" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateAdMarqueeBody | null;

  try {
    const placement = await createAdMarqueePlacement({
      href: body?.href,
      text: body?.text ?? "",
      userId: auth.user.id,
    });

    return NextResponse.json({ placement }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать заявку" }, { status: 400 });
  }
}
