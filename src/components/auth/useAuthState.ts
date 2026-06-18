"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type AuthState = "loading" | "signed-out" | "signed-in" | "admin";

type UserRoleRow = {
  role: string;
};

type AuthStateListener = (nextState: AuthState) => void;

type AuthStateResponse = {
  state?: AuthState;
};

let cachedState: AuthState = "loading";
let initialized = false;
let requestId = 0;
const listeners = new Set<AuthStateListener>();

function publishState(nextState: AuthState) {
  cachedState = nextState;
  listeners.forEach((listener) => listener(nextState));
}

async function resolveUserStateFromRoles(user: User, currentRequestId: number) {
  const supabase = getSupabaseBrowserClient();
  const { data: roles, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

  if (error) {
    throw error;
  }

  if (currentRequestId === requestId) {
    publishState((roles as UserRoleRow[] | null)?.some((item) => item.role === "admin") ? "admin" : "signed-in");
  }
}

async function resolveSessionState(session: Session | null | undefined, currentRequestId: number) {
  const user = session?.user;

  if (!user) {
    if (currentRequestId === requestId) {
      publishState("signed-out");
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
            publishState(payload.state);
          }
          return;
        }
      }
    }

    await resolveUserStateFromRoles(user, currentRequestId);
  } catch {
    if (currentRequestId === requestId) {
      publishState("signed-in");
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

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          throw error;
        }

        const currentRequestId = ++requestId;
        return resolveSessionState(data.session, currentRequestId);
      })
      .catch(() => publishState("signed-out"));

    supabase.auth.onAuthStateChange((_event, session) => {
      const currentRequestId = ++requestId;
      window.setTimeout(() => resolveSessionState(session, currentRequestId), 0);
    });
  } catch {
    publishState("signed-out");
  }
}

export function useAuthState() {
  const [state, setState] = useState<AuthState>(cachedState);

  useEffect(() => {
    ensureAuthStateInitialized();
    listeners.add(setState);
    setState(cachedState);

    return () => {
      listeners.delete(setState);
    };
  }, []);

  return { state };
}
