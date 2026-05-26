import { NextResponse } from "next/server";
import { createPayment } from "@/lib/payment-provider";
import { createFairApplication, listFairApplications } from "@/lib/mock-store";

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
};

const requiredFields: Array<keyof CreateFairApplicationBody> = ["participantName", "city", "category", "description", "phone", "email"];

function cleanText(value?: string) {
  return value?.trim() ?? "";
}

export async function GET() {
  return NextResponse.json({ applications: listFairApplications() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CreateFairApplicationBody | null;

  if (!body) {
    return NextResponse.json({ error: "Некорректные данные заявки" }, { status: 400 });
  }

  const missingField = requiredFields.find((field) => !cleanText(String(body[field] ?? "")));

  if (missingField) {
    return NextResponse.json({ error: "Заполните обязательные поля заявки" }, { status: 400 });
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

  const payment = createPayment({
    tariffId: "fair-participation",
    targetId: application.id,
    targetType: "fair_application",
    targetTitle: `Заявка на ярмарку: ${application.participantName}`,
  });

  return NextResponse.json({ application, payment }, { status: 201 });
}
