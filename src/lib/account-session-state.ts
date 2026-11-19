import type { LocalAccountUser } from "./local-account";

export type AccountAuthSnapshot = {
  state: "loading" | "signed-out" | "signed-in" | "admin" | "unavailable";
  userId: string | null;
  specialistTest?: true;
  workPublicationTest?: true;
  listingVerificationTest?: true;
};

export function canStartListingTest(account: AccountAuthSnapshot | null, owner: string | null): boolean {
  return !!account && !!owner && account.userId === owner && (account.state === "signed-in" || account.state === "admin")
    && (account.workPublicationTest === true || account.listingVerificationTest === true);
}

/** Display state only: resource permissions remain server-owned, never inferred from this cache. */
export function createAccountSessionState(session: (retryInitialRead?: () => boolean) => Promise<LocalAccountUser | null>) {
  let snapshot: AccountAuthSnapshot = { state: "loading", userId: null };
  let version = 0, changing = 0;
  const listeners = new Set<(value: AccountAuthSnapshot) => void>();
  function publish(state: AccountAuthSnapshot["state"], user?: LocalAccountUser | null) {
    const userId=user?.id??null, specialistTest=user?.specialistTest, workPublicationTest=user?.workPublicationTest;
    const listingVerificationTest=user?.listingVerificationTest;
    if (snapshot.state === state && snapshot.userId === userId && snapshot.specialistTest===specialistTest && snapshot.workPublicationTest===workPublicationTest && snapshot.listingVerificationTest===listingVerificationTest) return;
    snapshot = { state, userId, ...(specialistTest?{specialistTest}:{}), ...(workPublicationTest?{workPublicationTest}:{}), ...(listingVerificationTest?{listingVerificationTest}:{}) };
    listeners.forEach(listener => listener(snapshot));
  }
  async function refresh(background = false) {
    const current = ++version;
    // Anonymous UI holds no private identity. Publishing loading here would
    // unmount an embedded login form on focus or during its own submission.
    const initialRead = snapshot.state === "loading";
    const anonymous = snapshot.state === "signed-out";
    // Focus checks retain the last verified view; explicit account changes still fence it immediately.
    if (!anonymous && !background) publish("loading");
    if (changing) return;
    try {
      const user = await session(initialRead ? () => current === version && changing === 0 : undefined);
      if (user && (user.isBlocked !== false || !["user", "admin"].includes(user.role))) throw new Error("Invalid session view");
      if (current === version) publish(user ? user.role === "admin" ? "admin" : "signed-in" : "signed-out", user);
    } catch {
      if (current === version && !anonymous) publish("unavailable");
    }
  }
  return {
    read: () => snapshot,
    subscribe(listener: (value: AccountAuthSnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    beginChange() { changing++; version++; if (snapshot.state !== "signed-out") publish("loading"); },
    async endChange() { if (changing) changing--; await refresh(); },
    stop() { version++; changing = 0; listeners.clear(); snapshot = { state: "loading", userId: null }; },
  };
}
