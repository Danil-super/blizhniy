import { handleRegistrationRequest } from "@/lib/registration-http";
import { canShowWorkPublicationTest, canShowListingVerificationTest } from "@/lib/account-test-payment-config";
import { canShowSpecialistTest } from "@/lib/specialist-checkout-config";
import { handleProductionAccountRequest } from "@/lib/production-auth-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (process.env.BLIZHNIY_AUTH_MODE === "postgres") return handleProductionAccountRequest(request, action, canShowSpecialistTest, canShowWorkPublicationTest, canShowListingVerificationTest);
  return handleRegistrationRequest(request, action);
}

// A GET/email scanner must never consume confirmation tokens.
export const GET = POST;
