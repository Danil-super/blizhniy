"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

export type AdminAccessState = "loading" | "admin" | "signed-out" | "forbidden" | "error";

type UserRoleRow = {
  role: string;
};

type AuthStateResponse = {
  state?: "admin" | "signed-in" | "signed-out";
};

export function useAdminAccess() {
  const [state, setState] = useState<AdminAccessState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = isSupabaseBrowserConfigured() ? getSupabaseBrowserClient() : null;

    async function checkServerAdminState(session?: Session | null) {
      const stateResponse = await fetch("/api/auth/state", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });

      if (!stateResponse.ok) {
        return false;
      }

      const payload = (await stateResponse.json().catch(() => null)) as AuthStateResponse | null;

      if (payload?.state === "admin") {
        if (active) {
          setState("admin");
        }
        return true;
      }

      return false;
    }

    async function checkAdminRoleFromUser(user: User) {
      if (!supabase) {
        throw new Error("Supabase env is not configured");
      }

      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

      if (rolesError) {
        throw rolesError;
      }

      if (active) {
        setState((roles as UserRoleRow[] | null)?.some((item) => item.role === "admin") ? "admin" : "forbidden");
      }
    }

    async function checkAdminRole(session: Session | null | undefined) {
      try {
        if (await checkServerAdminState(session)) {
          return;
        }

        const user = session?.user;

        if (!user) {
          if (active) {
            setState("signed-out");
          }
          return;
        }

        await checkAdminRoleFromUser(user);
      } catch (error) {
        if (active) {
          setState("forbidden");
          setMessage(error instanceof Error ? error.message : "Не удалось проверить права администратора");
        }
      }
    }

    checkServerAdminState()
      .then((isAdmin) => {
        if (isAdmin) {
          return undefined;
        }

        if (!supabase) {
          if (active) {
            setState("signed-out");
          }
          return undefined;
        }

        return supabase.auth.getSession().then(({ data, error }) => {
          if (error) {
            throw error;
          }

          return checkAdminRole(data.session);
        });
      })
      .catch((error) => {
        if (active) {
          setState("error");
          setMessage(error instanceof Error ? error.message : "Не удалось проверить сессию");
        }
      });

    if (!supabase) {
      return () => {
        active = false;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState("loading");
      window.setTimeout(() => {
        checkAdminRole(session);
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { state, message };
}
