import { authJson } from "@/lib/auth-http";
import { readProductionAuthConfig } from "@/lib/production-auth-config";
import { getProductionAccountDatabase } from "@/lib/production-auth-runtime";
import { parsePushVapidPublicKey } from "@/lib/push-subscription-contract";
import { createPushSubscriptionHandler } from "@/lib/push-subscription-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (process.env.BLIZHNIY_PUSH !== "inbox-v1") return authJson({ error: { code: "NOT_FOUND" } }, 404);
    const auth = readProductionAuthConfig();
    if (!auth) return authJson({ error: { code: "NOT_FOUND" } }, 404);
    const publicKey = parsePushVapidPublicKey(process.env.BLIZHNIY_PUSH_PUBLIC_KEY);
    return await createPushSubscriptionHandler({ origin: auth.origin, publicKey }, () => getProductionAccountDatabase(auth))(request);
  } catch {
    return authJson({ error: { code: "PUSH_UNAVAILABLE" } }, 503);
  }
}
