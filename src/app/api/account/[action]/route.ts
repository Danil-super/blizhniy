import { handleRegistrationRequest } from "@/lib/registration-http";
import { handleProductionAccountRequest } from "@/lib/production-auth-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (process.env.BLIZHNIY_AUTH_MODE === "postgres") return handleProductionAccountRequest(request, action);
  return handleRegistrationRequest(request, action);
}

// A GET/email scanner must never consume confirmation tokens.
export const GET = POST;
