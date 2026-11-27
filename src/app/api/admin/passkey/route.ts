import { createAdminPasskeyHandler } from "@/lib/admin-passkey-http";
import { callHostedAdminPasskey } from "@/lib/admin-passkey-operator-client";
import { authJson } from "@/lib/auth-http";
import { hostedAdminPasskeysEnabled } from "@/lib/hosted-user-access-config";
import { readLocalRefundJournalConfig } from "@/lib/local-refund-admin-config";
import { readProductionAuthConfig } from "@/lib/production-auth-config";
import { getProductionAccountDatabase } from "@/lib/production-auth-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!hostedAdminPasskeysEnabled()) return authJson({ error: { code: "NOT_FOUND" } }, 404);
    const config = readProductionAuthConfig();
    if (!config) return authJson({ error: { code: "NOT_FOUND" } }, 404);
    return await createAdminPasskeyHandler({
      ...config, refundOptions: () => readLocalRefundJournalConfig()?.passkey === true,
    }, async () => {
      const { limiter } = await getProductionAccountDatabase(config);
      return { limiter, execute: callHostedAdminPasskey };
    })(request);
  } catch {
    return authJson({ error: { code: "PASSKEY_UNAVAILABLE" } }, 503);
  }
}
