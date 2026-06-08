import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPayment } from "@/lib/payment-provider";
import { createFairApplication, listFairApplications } from "@/lib/mock-store";
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

function cleanText(value?: string) {
  return value?.trim() ?? "";
}

function getRemoteIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined
  );
}

async function isAuthenticatedRequest(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return false;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
  });
  const { data, error } = await supabase.auth.getUser(token);

  return Boolean(data.user && !error);
}

export async function GET() {
  return NextResponse.json({ applications: listFairApplications() });
}

export async function POST(request: Request) {
  if (!(await isAuthenticatedRequest(request))) {
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

  const captchaVerified = await verifyTurnstileToken(cleanText(body.captchaToken), getRemoteIp(request));

  if (!captchaVerified) {
    return NextResponse.json({ error: TURNSTILE_ERROR_MESSAGE }, { status: 400 });
  }

  const application = createFairApplication({
    participantName: cleanText(body.participantName),
    city: cleanText(body.city),
    category: cleanText(body.category),
    description: cleanText(body.description),
    productPhotos: body.productPhotos?.map((item) => item.trim()).filter(Boolean) ?? [],
    videoUrl: cleanText(body.videoUrl) || undefined,
    phone: cleanText(body.phone),
    email: cleanText(body.email),
    comment: cleanText(body.comment) || undefined,
  });

  if (body.skipPayment === true) {
    application.paymentStatus = "succeeded";
    application.status = "published";
    return NextResponse.json({ application }, { status: 201 });
  }

  const payment = createPayment({
    tariffId: "fair-participation",
    targetId: application.id,
    targetType: "fair_application",
    targetTitle: `Заявка на ярмарку: ${application.participantName}`,
  });

  return NextResponse.json({ application, payment }, { status: 201 });
}
