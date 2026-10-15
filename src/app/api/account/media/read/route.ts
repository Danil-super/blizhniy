import { authJson } from "@/lib/auth-http";
import { handleProductionMediaRequest } from "@/lib/production-media-runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.BLIZHNIY_AUTH_MODE !== "postgres") return authJson({ error: { code: "NOT_FOUND" } }, 404);
  return handleProductionMediaRequest(request, "read");
}
export function GET() { return authJson({ error: { code: "METHOD_NOT_ALLOWED" } }, 405, { Allow: "POST" }); }
