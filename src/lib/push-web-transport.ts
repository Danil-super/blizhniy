import { createECDH } from "node:crypto";
import webPush from "web-push";
import { parsePushSubscription, parsePushVapidPublicKey } from "./push-subscription-contract.ts";

type Vapid = { subject: string; publicKey: string; privateKey: string };
export type PushJob = { id: string; endpoint: string; p256dh: string; auth: string; ttl: number };
export type PushOutcome = { code: "retry"; delay: number } | { code: "accepted" | "gone" | "rejected" | "unknown"; delay: 0 };

function retryAfter(header: string | null): number {
  if (!header) return 60;
  const until = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  return Number.isNaN(until) ? 60 : Math.max(1, Math.min(86400, until));
}

export function createWebPushTransport(vapid: Vapid, transport: (url: string, options: RequestInit) => Promise<Response> = fetch) {
  const privateKey = Buffer.from(vapid.privateKey, "base64url");
  try {
    const signingKey = createECDH("prime256v1");
    if (privateKey.length !== 32 || privateKey.toString("base64url") !== vapid.privateKey) throw new Error();
    signingKey.setPrivateKey(privateKey);
    if (signingKey.getPublicKey().toString("base64url") !== parsePushVapidPublicKey(vapid.publicKey)) throw new Error();
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error();
  } catch { throw new Error("Invalid Web Push configuration"); }
  finally { privateKey.fill(0); }

  return async (job: PushJob, parent?: AbortSignal): Promise<PushOutcome> => {
    let subscription: ReturnType<typeof parsePushSubscription>;
    try {
      subscription = parsePushSubscription({ endpoint: job.endpoint, keys: { auth: job.auth, p256dh: job.p256dh }, expirationTime: null });
    } catch { return { code: "gone", delay: 0 }; }

    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(job.id) ||
        !Number.isInteger(job.ttl) || job.ttl < 1 || job.ttl > 600) return { code: "rejected", delay: 0 };

    let details: ReturnType<typeof webPush.generateRequestDetails>;
    try {
      details = webPush.generateRequestDetails({ endpoint: subscription.endpoint,
        keys: { auth: subscription.auth, p256dh: subscription.p256dh } }, JSON.stringify({ id: job.id }),
      { vapidDetails: vapid, contentEncoding: "aes128gcm", TTL: job.ttl, topic: job.id.replaceAll("-", ""), urgency: "normal" });
    } catch { return { code: "rejected", delay: 0 }; }
    if (!details.body) return { code: "rejected", delay: 0 };

    try {
      const timeout = AbortSignal.timeout(8000);
      const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
      const response = await transport(subscription.endpoint, { method: "POST", headers: details.headers,
        body: new Uint8Array(details.body), redirect: "manual", signal });
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 200 && response.status < 300) return { code: "accepted", delay: 0 };
      if (response.status === 404 || response.status === 410) return { code: "gone", delay: 0 };
      if (response.status === 429) return { code: "retry", delay: retryAfter(response.headers.get("Retry-After")) };
      if (response.status >= 500) return { code: "unknown", delay: 0 };
      return { code: "rejected", delay: 0 };
    } catch { return { code: "unknown", delay: 0 }; }
  };
}
