import { handleRegistrationRequest } from "@/lib/registration-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  return handleRegistrationRequest(request, action);
}

// A GET/email scanner must never consume confirmation tokens.
export const GET = POST;
