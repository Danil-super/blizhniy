"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type AuthState = "loading" | "signed-out" | "signed-in" | "admin";

type UserRoleRow = {
  role: string;
};

export function useAuthState() {
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    let active = true;

    function setSafeState(nextState: AuthState) {
      if (active) {
        setState(nextState);
      }
    }

    async function resolveUserState(user: User | null | undefined) {
      if (!user) {
        setSafeState("signed-out");
        return;
      }

      try {
        const supabase = getSupabaseBrowserClient();
        const { data: roles, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

        if (error) {
          throw error;
        }

        setSafeState((roles as UserRoleRow[] | null)?.some((item) => item.role === "admin") ? "admin" : "signed-in");
      } catch {
        setSafeState("signed-in");
      }
    }

    try {
      const supabase = getSupabaseBrowserClient();

      supabase.auth
        .getSession()
        .then(({ data, error }) => {
          if (error) {
            throw error;
          }

          return resolveUserState(data.session?.user);
        })
        .catch(() => setSafeState("signed-out"));

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setSafeState("loading");
        window.setTimeout(() => resolveUserState(session?.user), 0);
      });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
    } catch {
      setSafeState("signed-out");
    }

    return () => {
      active = false;
    };
  }, []);

  return { state };
}
