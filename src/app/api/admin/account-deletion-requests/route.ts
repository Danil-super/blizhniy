import { NextResponse } from 'next/server';
import { listDeletionRequestsForAdmin, resolveDeletionReview, startDeletionReview, type DeletionResolution } from '@/lib/account-deletion-store';
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

    const page = Number(new URL(request.url).searchParams.get('page') ?? '0');
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) {
      return NextResponse.json({ error: 'Некорректная страница' }, { status: 400, headers: noStore });
    }

    const result = await listDeletionRequestsForAdmin(page);
    return NextResponse.json({ ...result, page }, { headers: noStore });
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

    const payload = (await request.json().catch(() => null)) as {
      requestId?: unknown;
      action?: unknown;
      resolution?: unknown;
      caseReference?: unknown;
      confirmedManualDecision?: unknown;
    } | null;

    if (!isUuid(typeof payload?.requestId === 'string' ? payload.requestId : undefined)) {
      return NextResponse.json({ error: 'Некорректный номер запроса' }, { status: 400, headers: noStore });
    }

    const requestId = payload!.requestId as string;
    let updated;

    if (payload?.action === 'begin') {
      updated = await startDeletionReview(requestId);
    } else if (payload?.action === 'resolve') {
      const validResolution = ['fulfilled', 'partly_retained', 'declined'].includes(String(payload.resolution));
      // A case reference identifies the protected manual record. Free text or
      // personal data must not be copied into this queue.
      const caseReference = typeof payload.caseReference === 'string' ? payload.caseReference.trim() : '';

      if (!validResolution || !/^[a-z0-9_-]{6,80}$/i.test(caseReference) || payload.confirmedManualDecision !== true) {
        return NextResponse.json({ error: 'Нужно выбрать решение, указать номер дела и подтвердить его исполнение' }, { status: 400, headers: noStore });
      }

      updated = await resolveDeletionReview(requestId, payload.resolution as DeletionResolution, caseReference);
    } else {
      return NextResponse.json({ error: 'Некорректное действие' }, { status: 400, headers: noStore });
    }

    if (!updated) {
      return NextResponse.json({ error: 'Состояние запроса уже изменилось или запрос не найден' }, { status: 409, headers: noStore });
    }

    return NextResponse.json({ request: updated }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Не удалось начать проверку' }, { status: 503, headers: noStore });
  }
}
