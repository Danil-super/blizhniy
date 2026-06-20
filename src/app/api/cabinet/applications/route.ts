import { NextResponse } from "next/server";
import { getStoredApplicationOwner, listStoredApplicationsForUser, markStoredApplicationViewed, updateStoredApplicationDecision } from "@/lib/application-store";
import { createStoredNotification } from "@/lib/notification-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";

type PatchApplicationBody = {
  action?: "view" | "select" | "reject";
  id?: string;
};

async function notifyApplicant(applicationId: string, event: string, subject: string, body: string) {
  const owner = await getStoredApplicationOwner(applicationId);

  if (!owner?.applicantUserId) {
    return;
  }

  await createStoredNotification({
    body,
    event,
    subject,
    userId: owner.applicantUserId,
  });
}

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы открыть отклики" }, { status: 401 });
  }

  const applications = await listStoredApplicationsForUser(auth.user.id);

  return NextResponse.json({ applications }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы изменить отклик" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as PatchApplicationBody | null;

  if (!body?.action || !["view", "select", "reject"].includes(body.action) || !body.id) {
    return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
  }

  const application =
    body.action === "view"
      ? await markStoredApplicationViewed(body.id, auth.user.id)
      : await updateStoredApplicationDecision(body.id, auth.user.id, body.action === "select" ? "selected" : "rejected");

  if (!application) {
    return NextResponse.json({ error: "Отклик не найден или уже обработан" }, { status: 404 });
  }

  if (body.action === "view") {
    await notifyApplicant(body.id, "application_viewed", "Отклик просмотрели", `Ваш отклик на «${application.vacancyTitle}» просмотрели.`);
  }

  if (body.action === "select") {
    await notifyApplicant(body.id, "application_selected", "Вас выбрали", `Ваш отклик на «${application.vacancyTitle}» отметили как выбранный.`);
  }

  if (body.action === "reject") {
    await notifyApplicant(body.id, "application_rejected", "Отклик отклонен", `Ваш отклик на «${application.vacancyTitle}» отклонили.`);
  }

  return NextResponse.json({ application });
}
