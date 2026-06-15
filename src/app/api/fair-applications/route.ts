import { NextResponse } from "next/server";
import { createPayment } from "@/lib/payment-provider";
import { createStoredFairApplication, listStoredFairApplications, markStoredFairApplicationPaid } from "@/lib/fair-application-store";
import { createFairApplication, listFairApplications } from "@/lib/mock-store";
import { getAuthenticatedRequestUser, isAdminRequest } from "@/lib/server-auth";
import { isSupabaseRestConfigured } from "@/lib/supabase-rest";
import { TURNSTILE_ERROR_MESSAGE, verifyTurnstileToken } from "@/lib/turnstile";

type CreateFairApplicationBody = {
  participantName?: string;
  city?: string;
  category?: string;
  description?: string;
  productPhotos?: string[];
  videoUrl?: string;
  phone?: string;
  email?: string;
  comment?: string;
  captchaToken?: string;
  skipPayment?: boolean;
};

const requiredFields: Array<keyof CreateFairApplicationBody> = ["participantName", "city", "category", "description", "phone", "email"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const urlPattern = /^https?:\/\/[^\s]+$/;

function cleanText(value?: string) {
  return value?.trim() ?? "";
}

function hasValidPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")));
}

function hasValidEmail(value: string) {
  return emailPattern.test(value);
}

function hasValidOptionalUrl(value: string) {
  return !value || urlPattern.test(value);
}

function cleanPhotos(value?: string[]) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => item.trim()).filter((item) => item && item.length <= 500).slice(0, 10);
}

function getRemoteIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined
  );
}

export async function GET() {
  const applications = isSupabaseRestConfigured()
    ? await listStoredFairApplications("published")
    : listFairApplications().filter((application) => application.status === "published");

  return NextResponse.json({ applications });
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ error: "Войдите или зарегистрируйтесь, чтобы подать заявку" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateFairApplicationBody | null;

  if (!body) {
    return NextResponse.json({ error: "Некорректные данные заявки" }, { status: 400 });
  }

  const missingField = requiredFields.find((field) => !cleanText(String(body[field] ?? "")));

  if (missingField) {
    return NextResponse.json({ error: "Заполните обязательные поля заявки" }, { status: 400 });
  }

  const participantName = cleanText(body.participantName);
  const city = cleanText(body.city);
  const category = cleanText(body.category);
  const description = cleanText(body.description);
  const phone = cleanText(body.phone);
  const email = cleanText(body.email);
  const videoUrl = cleanText(body.videoUrl);
  const photos = cleanPhotos(body.productPhotos);

  if (participantName.length < 2 || participantName.length > 120) {
    return NextResponse.json({ error: "Имя участника должно быть от 2 до 120 символов" }, { status: 400 });
  }

  if (description.length < 20 || description.length > 3000) {
    return NextResponse.json({ error: "Описание должно быть от 20 до 3000 символов" }, { status: 400 });
  }

  if (!hasValidPhone(phone)) {
    return NextResponse.json({ error: "Введите корректный телефон" }, { status: 400 });
  }

  if (!hasValidEmail(email)) {
    return NextResponse.json({ error: "Введите корректный email" }, { status: 400 });
  }

  if (!hasValidOptionalUrl(videoUrl)) {
    return NextResponse.json({ error: "Ссылка на видео должна начинаться с http:// или https://" }, { status: 400 });
  }

  if (body.skipPayment === true && !(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Создать заявку без оплаты может только администратор" }, { status: 403 });
  }

  const captchaVerified = await verifyTurnstileToken(cleanText(body.captchaToken), getRemoteIp(request));

  if (!captchaVerified) {
    return NextResponse.json({ error: TURNSTILE_ERROR_MESSAGE }, { status: 400 });
  }

  const applicationInput = {
    participantName,
    city,
    category,
    description,
    productPhotos: photos,
    videoUrl: videoUrl || undefined,
    phone,
    email,
    comment: cleanText(body.comment) || undefined,
  };
  const application = isSupabaseRestConfigured()
    ? await createStoredFairApplication({ ...applicationInput, userId: auth.user.id })
    : createFairApplication(applicationInput);

  if (body.skipPayment === true) {
    application.paymentStatus = "succeeded";
    application.status = "published";

    if (isSupabaseRestConfigured()) {
      await markStoredFairApplicationPaid(application.id);
    }

    return NextResponse.json({ application }, { status: 201 });
  }

  const payment = await createPayment({
    tariffId: "fair-participation",
    targetId: application.id,
    targetType: "fair_application",
    targetTitle: `Заявка на ярмарку: ${application.participantName}`,
    userId: auth.user.id,
  });

  return NextResponse.json({ application, payment }, { status: 201 });
}
