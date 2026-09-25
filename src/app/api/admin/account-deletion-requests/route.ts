import { NextResponse } from 'next/server';
import { listDeletionRequestsForAdmin, startDeletionReview } from '@/lib/account-deletion-store';
import { isAdminRequest } from '@/lib/server-auth';
import { isSupabaseServiceRoleConfigured, isUuid } from '@/lib/supabase-rest';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try {
    if (!(await isAdminRequest(request))) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403, headers: noStore });
    }

    if (!isSupabaseServiceRoleConfigured()) {
      return NextResponse.json({ error: 'Сервис временно недоступен' }, { status: 503, headers: noStore });
    }

    return NextResponse.json({ requests: await listDeletionRequestsForAdmin() }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Не удалось загрузить запросы' }, { status: 503, headers: noStore });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await isAdminRequest(request))) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403, headers: noStore });
    }

    if (!isSupabaseServiceRoleConfigured()) {
      return NextResponse.json({ error: 'Сервис временно недоступен' }, { status: 503, headers: noStore });
    }

    const payload = (await request.json().catch(() => null)) as { requestId?: unknown } | null;

    if (!isUuid(typeof payload?.requestId === 'string' ? payload.requestId : undefined)) {
      return NextResponse.json({ error: 'Некорректный номер запроса' }, { status: 400, headers: noStore });
    }

    const updated = await startDeletionReview(payload!.requestId as string);

    if (!updated) {
      return NextResponse.json({ error: 'Запрос уже взят на проверку или не найден' }, { status: 409, headers: noStore });
    }

    return NextResponse.json({ request: updated }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Не удалось начать проверку' }, { status: 503, headers: noStore });
  }
}
