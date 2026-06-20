import { NextResponse } from "next/server";
import { createStoredApplication, ensureVacancyCanReceiveApplication, ensureWorkRequestCanReceiveApplication } from "@/lib/application-store";
import { createPayment } from "@/lib/payment-provider";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { getActiveStoredSpecialistProfileForUser, getSpecialistProfileCompleteness } from "@/lib/specialist-profile-store";
import { isSupabaseServiceRoleConfigured } from "@/lib/supabase-rest";

type CreateApplicationBody = {
  message?: string;
  snapshot?: {
    email?: string;
    messengerUrl?: string;
    name?: string;
    phone?: string;
    price?: string;
    profession?: string;
    skills?: string;
  };
  tariffId?: string;
  vacancyId?: string;
  workRequestId?: string;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Server storage is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы откликнуться на вакансию" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateApplicationBody | null;
  const vacancyId = cleanString(body?.vacancyId);
  const workRequestId = cleanString(body?.workRequestId);

  if (!vacancyId && !workRequestId) {
    return NextResponse.json({ error: "vacancyId or workRequestId is required" }, { status: 400 });
  }

  if (vacancyId && workRequestId) {
    return NextResponse.json({ error: "Укажите только одну цель отклика" }, { status: 400 });
  }

  const specialist = await getActiveStoredSpecialistProfileForUser(auth.user.id);
  const completeness = getSpecialistProfileCompleteness(specialist);

  if (!specialist || !completeness.complete) {
    return NextResponse.json(
      { error: completeness.missing.length ? `Активируйте анкету специалиста и заполните: ${completeness.missing.join(", ")}.` : "Активируйте анкету специалиста перед откликом." },
      { status: 400 },
    );
  }

  try {
    const target = workRequestId
      ? await ensureWorkRequestCanReceiveApplication(workRequestId, auth.user.id)
      : await ensureVacancyCanReceiveApplication(vacancyId, auth.user.id);
    const targetKind = workRequestId ? "заказ" : "вакансию";
    const application = await createStoredApplication({
      applicantUserId: auth.user.id,
      message: cleanString(body?.message).slice(0, 700),
      snapshot: {
        email: specialist.email,
        messengerUrl: specialist.messengerUrl,
        name: specialist.name,
        phone: specialist.phone,
        price: specialist.price,
        profession: specialist.profession,
        skills: specialist.skills,
      },
      specialistProfileId: specialist.id,
      vacancyId,
      workRequestId,
    });

    if (!application?.id) {
      return NextResponse.json({ error: "Не удалось создать отклик" }, { status: 500 });
    }

    const canReusePayment = Boolean(application.paymentId && application.paymentStatus === "succeeded");
    const payment = canReusePayment
      ? undefined
      : await createPayment({
          tariffId: cleanString(body?.tariffId) || "job-response",
          targetId: application.id,
          targetTitle: `Отклик ${specialist.name} на ${targetKind} ${target.title}`,
          targetType: "application",
          userId: auth.user.id,
        });

    return NextResponse.json({ application: { ...application, paymentId: payment?.id ?? application.paymentId, paymentStatus: payment?.status ?? application.paymentStatus }, payment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать отклик" }, { status: 400 });
  }
}
