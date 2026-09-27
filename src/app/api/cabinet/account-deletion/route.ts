import { NextResponse } from 'next/server';
import { getDeletionRequestForUser, requestAccountDeletion } from '@/lib/account-deletion-store';
import { getVerifiedRequestUser, isSupabaseServerConfigured } from '@/lib/server-auth';
import { isSupabaseServiceRoleConfigured } from '@/lib/supabase-rest';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

async function verifiedUser(request: Request) {
  if (!isSupabaseServerConfigured() || !isSupabaseServiceRoleConfigured()) {
    return { error: NextResponse.json({ error: 'Сервис временно недоступен' }, { status: 503, headers: noStore }) };
  }

  const auth = await getVerifiedRequestUser(request);

  return auth
    ? { id: auth.user.id }
    : { error: NextResponse.json({ error: 'Войдите в аккаунт, чтобы отправить запрос' }, { status: 401, headers: noStore }) };
}

export async function GET(request: Request) {
  try {
    const result = await verifiedUser(request);

    if (result.error) return result.error;

    const deletionRequest = await getDeletionRequestForUser(result.id!);
    return NextResponse.json({ request: deletionRequest }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Не удалось получить статус запроса. Повторите позже.' }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  try {
    const result = await verifiedUser(request);

    if (result.error) return result.error;

    const deletionRequest = await requestAccountDeletion(result.id!);

    if (!deletionRequest) {
      throw new Error('No deletion request persisted');
    }

    return NextResponse.json({ request: deletionRequest }, { status: 202, headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Не удалось зарегистрировать запрос. Повторите позже.' }, { status: 503, headers: noStore });
  }
}
