"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type AuthState = "loading" | "signed-out" | "signed-in" | "admin";

export type AuthStateSnapshot = {
  state: AuthState;
  userId: string | null;
};

type UserRoleRow = {
  role: string;
};

type AuthStateListener = (nextSnapshot: AuthStateSnapshot) => void;

type AuthStateResponse = {
  state?: AuthState;
};

let cachedSnapshot: AuthStateSnapshot = { state: "loading", userId: null };
let initialized = false;
let requestId = 0;
const listeners = new Set<AuthStateListener>();

function publishState(nextState: AuthState, userId: string | null) {
  if (cachedSnapshot.state === nextState && cachedSnapshot.userId === userId) {
    return;
  }

  cachedSnapshot = { state: nextState, userId };
  listeners.forEach((listener) => listener(cachedSnapshot));
}

function prepareSessionState(session: Session | null | undefined) {
  const userId = session?.user?.id ?? null;

  if (!userId) {
    publishState("signed-out", null);
    return;
  }

  if (cachedSnapshot.userId !== userId) {
    // Do not let an authenticated subtree for the previous account stay mounted
    // while the new account's role is being resolved.
    publishState("loading", userId);
  }
}

async function resolveUserStateFromRoles(user: User, currentRequestId: number) {
  const supabase = getSupabaseBrowserClient();
  const { data: roles, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

  if (error) {
    throw error;
  }

  if (currentRequestId === requestId) {
    publishState((roles as UserRoleRow[] | null)?.some((item) => item.role === "admin") ? "admin" : "signed-in", user.id);
  }
}

async function resolveSessionState(session: Session | null | undefined, currentRequestId: number) {
  if (currentRequestId !== requestId) {
    return;
  }

  const user = session?.user;

  if (!user) {
    if (currentRequestId === requestId) {
      publishState("signed-out", null);
    }
    return;
  }

  try {
    if (session?.access_token) {
      const response = await fetch("/api/auth/state", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as AuthStateResponse | null;

        if (payload?.state === "admin" || payload?.state === "signed-in") {
          if (currentRequestId === requestId) {
            publishState(payload.state, user.id);
          }
          return;
        }
      }
    }

    await resolveUserStateFromRoles(user, currentRequestId);
  } catch {
    if (currentRequestId === requestId) {
      publishState("signed-in", user.id);
    }
  }
}

function ensureAuthStateInitialized() {
  if (initialized) {
    return;
  }

  initialized = true;

  try {
    const supabase = getSupabaseBrowserClient();

    const initialRequestId = ++requestId;

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          throw error;
        }

        if (initialRequestId !== requestId) {
          return;
        }

        prepareSessionState(data.session);
        return resolveSessionState(data.session, initialRequestId);
      })
      .catch(() => {
        if (initialRequestId === requestId) {
          publishState("signed-out", null);
        }
      });

    supabase.auth.onAuthStateChange((_event, session) => {
      const currentRequestId = ++requestId;
      prepareSessionState(session);

      if (!session?.user) {
        return;
      }

      window.setTimeout(() => resolveSessionState(session, currentRequestId), 0);
    });
  } catch {
    publishState("signed-out", null);
  }
}

export function useAuthState() {
  const [snapshot, setSnapshot] = useState<AuthStateSnapshot>(cachedSnapshot);

  useEffect(() => {
    ensureAuthStateInitialized();
    listeners.add(setSnapshot);
    setSnapshot(cachedSnapshot);

    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);

  return snapshot;
}
