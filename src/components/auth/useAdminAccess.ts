"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type AdminAccessState = "loading" | "admin" | "signed-out" | "forbidden" | "error";

type UserRoleRow = {
  role: string;
};

export function useAdminAccess() {
  const [state, setState] = useState<AdminAccessState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    async function checkAdminRole(user: User | null | undefined) {
      try {
        if (!user) {
          if (active) {
            setState("signed-out");
          }
          return;
        }

        const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

        if (rolesError) {
          throw rolesError;
        }

        if (active) {
          setState((roles as UserRoleRow[] | null)?.some((item) => item.role === "admin") ? "admin" : "forbidden");
        }
      } catch (error) {
        if (active) {
          setState("forbidden");
          setMessage(error instanceof Error ? error.message : "Не удалось проверить права администратора");
        }
      }
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          throw error;
        }

        return checkAdminRole(data.session?.user);
      })
      .catch((error) => {
        if (active) {
          setState("error");
          setMessage(error instanceof Error ? error.message : "Не удалось проверить сессию");
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState("loading");
      window.setTimeout(() => {
        checkAdminRole(session?.user);
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { state, message };
}
