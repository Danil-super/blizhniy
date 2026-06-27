import { NextResponse } from "next/server";
import { getPayableAdMarqueePlacementForUser } from "@/lib/ad-marquee-store";
import { getStoredApplicationForPayment } from "@/lib/application-store";
import { getStoredListingForUser, markStoredListingPendingPaymentForUser } from "@/lib/listing-store";
import { createPayment, listPayments } from "@/lib/payment-provider";
import { getAuthenticatedRequestUser, isAdminRequest, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isUuid } from "@/lib/supabase-rest";
import type { Payment } from "@/lib/types";
import { getStoredVacancyForUser, markStoredVacancyPendingPaymentForUser } from "@/lib/vacancy-store";
import { normalizeVacancyRequisites, validateVacancyRequisites } from "@/lib/vacancy-requisites";
import { getStoredWorkRequestForUser, markStoredWorkRequestPendingPaymentForUser } from "@/lib/work-request-store";

type CreatePaymentBody = {
  tariffId?: string;
  targetId?: string;
  targetType?: Payment["targetType"];
  targetTitle?: string;
};

export async function GET(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const payments = await listPayments();

  return NextResponse.json({ payments });
}

export async function POST(request: Request) {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы создать платеж" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreatePaymentBody | null;

  if (!body?.tariffId) {
    return NextResponse.json({ error: "tariffId is required" }, { status: 400 });
  }

  try {
    let targetTitle = body.targetTitle;

    if (body.targetType === "listing") {
      if (!body.targetId || !isUuid(body.targetId)) {
        return NextResponse.json({ error: "Сначала сохраните объявление, затем оплатите публикацию" }, { status: 400 });
      }

      const listing = await getStoredListingForUser(body.targetId, auth.user.id);

      if (!listing) {
        return NextResponse.json({ error: "Объявление не найдено или уже удалено" }, { status: 404 });
      }

      if (listing.status === "published") {
        return NextResponse.json({ error: "Объявление уже опубликовано" }, { status: 400 });
      }

      if (listing.status === "archived" || listing.status === "sold" || listing.status === "expired" || listing.status === "rejected") {
        return NextResponse.json({ error: "Это объявление снято с публикации. Создайте новое или восстановите доступное объявление." }, { status: 400 });
      }

      if (listing.status === "draft") {
        const updated = await markStoredListingPendingPaymentForUser(body.targetId, auth.user.id);

        if (!updated) {
          return NextResponse.json({ error: "Не удалось подготовить объявление к оплате. Обновите страницу и попробуйте снова." }, { status: 409 });
        }
      }

      targetTitle = listing.title;
    }

    if (body.targetType === "vacancy") {
      if (!body.targetId || !isUuid(body.targetId)) {
        return NextResponse.json({ error: "Сначала сохраните вакансию, затем оплатите публикацию" }, { status: 400 });
      }

      const vacancy = await getStoredVacancyForUser(body.targetId, auth.user.id);

      if (!vacancy) {
        return NextResponse.json({ error: "Вакансия не найдена или уже удалена" }, { status: 404 });
      }

      if (vacancy.status === "published") {
        return NextResponse.json({ error: "Вакансия уже опубликована" }, { status: 400 });
      }

      if (!vacancy.images?.length) {
        return NextResponse.json({ error: "Добавьте фото работодателя или рабочего места перед оплатой вакансии" }, { status: 400 });
      }

      const requisitesError = validateVacancyRequisites(
        normalizeVacancyRequisites({
          employerType: vacancy.employerType,
          inn: vacancy.inn,
          ogrn: vacancy.ogrn,
          ogrnip: vacancy.ogrnip,
        }),
        { requireInn: true },
      );

      if (requisitesError) {
        return NextResponse.json({ error: requisitesError }, { status: 400 });
      }

      if (vacancy.status === "archived" || vacancy.status === "expired" || vacancy.status === "rejected") {
        return NextResponse.json({ error: "Эта вакансия снята с публикации. Создайте новую или восстановите доступную вакансию." }, { status: 400 });
      }

      if (vacancy.status === "draft") {
        const updated = await markStoredVacancyPendingPaymentForUser(body.targetId, auth.user.id);

        if (!updated) {
          return NextResponse.json({ error: "Не удалось подготовить вакансию к оплате. Обновите страницу и попробуйте снова." }, { status: 409 });
        }
      }

      targetTitle = vacancy.title;
    }

    if (body.targetType === "workRequest") {
      if (!body.targetId || !isUuid(body.targetId)) {
        return NextResponse.json({ error: "Сначала сохраните заказ, затем оплатите публикацию" }, { status: 400 });
      }

      const request = await getStoredWorkRequestForUser(body.targetId, auth.user.id);

      if (!request) {
        return NextResponse.json({ error: "Заказ не найден или уже удален" }, { status: 404 });
      }

      if (request?.status === "published") {
        return NextResponse.json({ error: "Заказ уже опубликован" }, { status: 400 });
      }

      if (request && (request.status === "archived" || request.status === "expired" || request.status === "rejected")) {
        return NextResponse.json({ error: "Этот заказ снят с публикации. Создайте новый заказ." }, { status: 400 });
      }

      if (request?.status === "draft") {
        await markStoredWorkRequestPendingPaymentForUser(body.targetId, auth.user.id);
      }
    }

    if (body.targetType === "application") {
      if (!body.targetId || !isUuid(body.targetId)) {
        return NextResponse.json({ error: "Сначала создайте отклик, затем оплатите отправку" }, { status: 400 });
      }

      if (body.tariffId !== "job-response") {
        return NextResponse.json({ error: "Для отклика доступен только тариф отклика" }, { status: 400 });
      }

      const application = await getStoredApplicationForPayment(body.targetId, auth.user.id);

      if (!application) {
        return NextResponse.json({ error: "Отклик не найден, уже отправлен или принадлежит другому пользователю" }, { status: 404 });
      }

      targetTitle =
        application.targetType === "workRequest"
          ? `Отклик ${application.specialistName} на заказ ${application.workRequestTitle ?? application.vacancyTitle}`
          : `Отклик ${application.specialistName} на вакансию ${application.vacancyTitle}`;
    }

    if (body.targetType === "ad_marquee") {
      if (!body.targetId || !isUuid(body.targetId)) {
        return NextResponse.json({ error: "Сначала отправьте текст бегущей строки на модерацию" }, { status: 400 });
      }

      if (body.tariffId !== "ad-marquee") {
        return NextResponse.json({ error: "Для бегущей строки доступен только тариф бегущей строки" }, { status: 400 });
      }

      const placement = await getPayableAdMarqueePlacementForUser(body.targetId, auth.user.id);

      if (!placement) {
        return NextResponse.json({ error: "Заявка еще не одобрена администратором или уже оплачена" }, { status: 404 });
      }

      targetTitle = `Бегущая строка: ${placement.text}`;
    }

    const payment = await createPayment({
      tariffId: body.tariffId,
      targetId: body.targetId,
      targetType: body.targetType,
      targetTitle,
      userId: auth.user.id,
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    console.error("Payment creation failed", {
      error: error instanceof Error ? error.message : String(error),
      hasTargetId: Boolean(body.targetId),
      tariffId: body.tariffId,
      targetType: body.targetType,
      userId: auth.user.id,
    });

    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment creation failed" }, { status: 400 });
  }
}
