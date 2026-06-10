"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type AuthState = "loading" | "signed-out" | "signed-in" | "admin";

type UserRoleRow = {
  role: string;
};

type AuthStateListener = (nextState: AuthState) => void;

let cachedState: AuthState = "loading";
let initialized = false;
let requestId = 0;
const listeners = new Set<AuthStateListener>();

function publishState(nextState: AuthState) {
  cachedState = nextState;
  listeners.forEach((listener) => listener(nextState));
}

async function resolveUserState(user: User | null | undefined, currentRequestId: number) {
  if (!user) {
    if (currentRequestId === requestId) {
      publishState("signed-out");
    }
    return;
  }

  try {
    const supabase = getSupabaseBrowserClient();
    const { data: roles, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

    if (error) {
      throw error;
    }

    if (currentRequestId === requestId) {
      publishState((roles as UserRoleRow[] | null)?.some((item) => item.role === "admin") ? "admin" : "signed-in");
    }
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
        return resolveUserState(data.session?.user, currentRequestId);
      })
      .catch(() => publishState("signed-out"));

    supabase.auth.onAuthStateChange((_event, session) => {
      const currentRequestId = ++requestId;
      window.setTimeout(() => resolveUserState(session?.user, currentRequestId), 0);
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
