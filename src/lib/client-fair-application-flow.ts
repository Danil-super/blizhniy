"use client";

import { captureClientUserOperation } from "@/lib/client-user-profile";

export type SavedFairApplication = { id: string; ownerKey: string };

/** A retry pays the saved owner-bound target; it never submits the form twice. */
export async function submitFairApplicationCheckout(input: {
  adminMode: boolean;
  captchaToken: string;
  data: FormData;
  savedApplication?: SavedFairApplication;
  onSaved: (application: SavedFairApplication) => void;
  uploadPhotos: (data: FormData, token: string) => Promise<string[]>;
}) {
  const origin = await captureClientUserOperation(input.savedApplication?.ownerKey);
  const identity = origin.identity;

  if (!identity.accessToken) throw new Error("Сессия входа устарела. Войдите повторно.");
  await origin.assertCurrentSession();

  let endpoint: string;
  let body: Record<string, unknown>;
  if (input.savedApplication) {
    endpoint = "/api/payments";
    body = { tariffId: "fair-participation", targetType: "fair_application", targetId: input.savedApplication.id };
  } else {
    const productPhotos = await input.uploadPhotos(input.data, identity.accessToken);
    await origin.assertCurrentSession();
    endpoint = "/api/fair-applications";
    body = Object.fromEntries(["participantName", "city", "category", "description", "videoUrl", "phone", "email", "comment"].map(key => [key, input.data.get(key)]));
    Object.assign(body, { productPhotos, captchaToken: input.captchaToken, skipPayment: input.adminMode });
  }

  await origin.assertCurrentSession();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${identity.accessToken}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  await origin.assertCurrentSession();

  if (!response.ok) throw new Error(payload?.error ?? "Не удалось подготовить оплату заявки.");
  if (!input.savedApplication) {
    const id = payload?.application?.id;
    if (typeof id !== "string" || !id || id.length > 100) throw new Error("Сервер не подтвердил сохранение заявки.");
    input.onSaved({ id, ownerKey: identity.ownerKey });
  }

  if (input.adminMode) return { destination: "/cabinet/fair-applications", external: false, identity };
  if (typeof payload?.paymentError === "string") throw new Error(payload.paymentError);

  const payment = payload?.payment;
  if (typeof payment?.id !== "string" || !payment.id || payment.id.length > 100) {
    throw new Error("Заявка сохранена. Продолжите оплату сохранённой заявки или откройте кабинет.");
  }

  await origin.assertCurrentSession();
  return {
    destination: typeof payment.confirmationUrl === "string" && payment.confirmationUrl
      ? payment.confirmationUrl : `/oplata/${encodeURIComponent(payment.id)}`,
    external: Boolean(payment.confirmationUrl),
    identity,
  };
}
