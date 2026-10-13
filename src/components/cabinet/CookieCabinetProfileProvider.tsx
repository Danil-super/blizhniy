"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePrimaryAccountAuth } from "@/components/auth/AccountAuthProvider";
import type { AccountAuthSnapshot } from "@/lib/account-session-state";
import type { CabinetProfile } from "@/lib/cabinet-profile";
import { CookieProfileError, productionProfile } from "@/lib/client-postgres-profile";
import { notifyAccountSessionChange } from "@/lib/local-account";

type Snapshot = { ownerId: string | null; profile: CabinetProfile | null; revision?: string | null; conflict?: boolean; error?: string; loading: boolean };
type Value = Snapshot & { saveProfile: (profile: CabinetProfile) => Promise<CabinetProfile>; reload: () => void };
const Context = createContext<Value | null>(null);
const empty: Snapshot = { ownerId: null, profile: null, loading: true };
export function useCookieCabinetProfile() { return useContext(Context); }

function ProfileScope({ auth, children }: { auth: AccountAuthSnapshot; children: ReactNode }) {
  const owner = auth.state === "signed-in" || auth.state === "admin" ? auth.userId : null;
  const latestOwner = useRef(owner); latestOwner.current = owner;
  const version = useRef(0), pendingWrite = useRef<object | null>(null), scope = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  useEffect(() => {
    const generation = ++version.current;
    const controller = new AbortController(); scope.current = controller;
    setSnapshot({ ...empty, ownerId: owner });
    if (owner) void productionProfile.read(owner, { signal: controller.signal }).then(saved => {
      if (generation === version.current && latestOwner.current === owner) setSnapshot({ ownerId: owner, ...saved, loading: false });
    }).catch(() => {
      if (generation === version.current && latestOwner.current === owner) setSnapshot({ ownerId: owner, profile: null,
        error: "Не удалось загрузить профиль. Проверьте сессию и обновите данные.", loading: false });
    });
    return () => { version.current = generation+1; controller.abort(); pendingWrite.current = null; };
  }, [owner]);

  async function saveProfile(profile: CabinetProfile): Promise<CabinetProfile> {
    if (!owner || latestOwner.current !== owner || snapshot.ownerId !== owner || !snapshot.profile || snapshot.loading || snapshot.error) {
      throw new CookieProfileError("SESSION_CHANGED");
    }
    if (snapshot.conflict) throw new CookieProfileError("PROFILE_CHANGED");
    if (snapshot.revision === undefined) throw new CookieProfileError("UNKNOWN");
    if (pendingWrite.current) throw new Error("Сохранение профиля уже выполняется.");
    const generation = version.current, attempt = {};
    pendingWrite.current = attempt;
    try {
      const saved = await productionProfile.write(owner, profile, snapshot.revision, { signal: scope.current?.signal });
      if (generation !== version.current || latestOwner.current !== owner) throw new CookieProfileError("SESSION_CHANGED");
      setSnapshot({ ownerId: owner, ...saved, loading: false });
      return saved.profile;
    } catch (error) {
      if (generation === version.current && latestOwner.current === owner && error instanceof CookieProfileError && error.code === "PROFILE_CHANGED") {
        setSnapshot({ ...snapshot, conflict: true });
      } else if (generation === version.current && latestOwner.current === owner &&
          (!(error instanceof CookieProfileError) || !["INVALID_INPUT", "RATE_LIMITED"].includes(error.code))) {
        setSnapshot({ ownerId: owner, profile: null, loading: false,
          error: "Сохранение не подтверждено. Обновите профиль перед повторной попыткой." });
      }
      throw error;
    } finally { if (pendingWrite.current === attempt) pendingWrite.current = null; }
  }
  // In-flight data is never displayed for a changed or unverified identity, even before effect cleanup.
  const visible = owner && snapshot.ownerId === owner ? snapshot : empty;
  const reload = () => notifyAccountSessionChange(false);
  return <Context.Provider value={{ ...visible, saveProfile, reload }}>
    {visible.conflict ? <CabinetProfileFailure message="Профиль изменён в другой вкладке. Скопируйте несохранённые изменения и обновите профиль." reload={reload} /> : null}
    {children}
  </Context.Provider>;
}

export function CookieCabinetProfileProvider({ children }: { children: ReactNode }) {
  const auth = usePrimaryAccountAuth();
  if (!auth) return children;
  return <ProfileScope auth={auth}>{children}</ProfileScope>;
}

export function CabinetProfileFailure({ message, reload }: { message: string; reload?: () => void }) {
  return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700">
    <p>{message}</p>
    {reload ? <button type="button" onClick={reload} className="mt-3 inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-4 font-semibold">
      Обновить профиль
    </button> : null}
  </div>;
}
