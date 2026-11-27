import { readAccountSessionToken } from "./account-cookie.ts";
import { authJson, AuthRequestError, readAuthJson, type AuthRateLimiter } from "./auth-http.ts";
import { hashSessionToken } from "./identity.ts";
import { ListingDraftInputError, parseListingDraftId } from "./listing-draft-contract.ts";
import { parsePushSubscription, PushSubscriptionInputError } from "./push-subscription-contract.ts";
import { getTrustedProxyIp } from "./trusted-proxy-ip.ts";
import type { PostgresQueries } from "./postgres.ts";

type Runtime = { db: PostgresQueries; limiter: Pick<AuthRateLimiter, "allowPushSubscription"> };

const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export function createPushSubscriptionHandler(config: { origin: string; publicKey: string }, runtime: () => Runtime | Promise<Runtime>) {
  return async (request: Request) => {
    try {
      const raw = await readAuthJson(request, config);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PushSubscriptionInputError();
      const row = raw as Record<string, unknown>;
      const { action } = row;
      const keys = action === "authorize" ? ["action", "id"] :
        action === "subscribe" ? ["action", "expectedOwnerId", "subscription"] :
          action === "status" || action === "unsubscribe" ? ["action", "expectedOwnerId"] : [];
      if (!keys.length || Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) {
        throw new PushSubscriptionInputError();
      }
      const id = parseListingDraftId(action === "authorize" ? row.id : row.expectedOwnerId);
      const subscription = action === "subscribe" ? parsePushSubscription(row.subscription) : null;
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, "UNTRUSTED_INGRESS");
      const token = readAccountSessionToken(request);
      const sessionKey = token && hashSessionToken(token);
      if (!sessionKey) throw new AuthRequestError(401, "UNAUTHENTICATED");
      const { db, limiter } = await runtime();
      if (!await limiter.allowPushSubscription(ip)) throw new AuthRequestError(429, "RATE_LIMITED");

      if (action === "authorize") {
        const { rows: [value] } = await db.query<{ allowed: boolean }>(
          "select app_push.may_display($1,$2) as allowed", [sessionKey, id]);
        if (value?.allowed) return noContent();
        throw new AuthRequestError(404, "NOT_FOUND");
      }

      if (action === "status") {
        const { rows: [value] } = await db.query<{ state: string }>(
          "select app_push.subscription_state($1,$2) as state", [sessionKey, id]);
        if (value?.state === "unauthenticated") throw new AuthRequestError(401, "UNAUTHENTICATED");
        if (value && ["active", "preference_off", "ready"].includes(value.state)) {
          return authJson({ status: value.state, publicKey: config.publicKey }, 200);
        }
        throw new Error("Push subscription state unavailable");
      }

      const { rows: [result] } = await db.query<{ state: string }>(
        "select app_push.set_subscription($1,$2,$3,$4,$5,$6) as state",
        [sessionKey, id, subscription?.endpoint ?? null, subscription?.p256dh ?? null, subscription?.auth ?? null,
          subscription?.expirationTime == null ? null : new Date(subscription.expirationTime)],
      );
      if (result?.state === "ok") return noContent();
      if (result?.state === "unauthenticated") throw new AuthRequestError(401, "UNAUTHENTICATED");
      if (result?.state === "preference_off") throw new AuthRequestError(409, "PUSH_PREFERENCE_OFF");
      if (result?.state === "conflict" || result?.state === "expired") throw new AuthRequestError(409, "PUSH_SUBSCRIPTION_CHANGED");
      throw new Error("Push subscription write unavailable");
    } catch (error) {
      if (error instanceof ListingDraftInputError || error instanceof PushSubscriptionInputError) {
        error = new AuthRequestError(422, "INVALID_INPUT");
      }
      const status = error instanceof AuthRequestError ? error.status : 503;
      const code = error instanceof AuthRequestError ? error.code : "PUSH_UNAVAILABLE";
      return authJson({ error: { code } }, status, status === 429 ? { "Retry-After": "900" } : undefined);
    }
  };
}
