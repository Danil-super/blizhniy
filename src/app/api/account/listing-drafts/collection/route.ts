import { authJson } from "@/lib/auth-http";
import { handleProductionListingDraftRequest } from "@/lib/production-listing-draft-runtime";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.BLIZHNIY_AUTH_MODE !== "postgres") return authJson({ error: { code: "NOT_FOUND" } }, 404);
  return handleProductionListingDraftRequest(request, true);
}
export async function PUT(request: Request) {
  if (process.env.BLIZHNIY_AUTH_MODE !== "postgres") return authJson({ error: { code: "NOT_FOUND" } }, 404);
  return handleProductionListingDraftRequest(request, true);
}
export function GET() {
  return authJson({ error: { code: "METHOD_NOT_ALLOWED" } }, 405, { Allow: "POST, PUT" });
}
