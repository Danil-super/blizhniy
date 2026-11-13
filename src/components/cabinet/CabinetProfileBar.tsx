"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { useAuthState } from "@/components/auth/useAuthState";
import { usePrimaryAccountAuth } from "@/components/auth/AccountAuthProvider";
import { CabinetProfileFailure, useCookieCabinetProfile } from "./CookieCabinetProfileProvider";
import { SettingsPanelLoader } from "./SettingsPanelLoader";
import type { CabinetProfile } from "@/lib/cabinet-profile";
import type { ClientUserIdentity } from "@/lib/client-user-profile";

export type CabinetProfileData = {
  identity: ClientUserIdentity | null;
  profile: CabinetProfile | null;
  profileError?: string;
  loading: boolean;
  saveProfile?: (profile: CabinetProfile) => Promise<CabinetProfile>;
  reloadProfile?: () => void;
};

const LegacyProfileBar = dynamic(() => import("./CabinetClient").then(module => module.CabinetProfileBar));

export function CabinetProfileBar() {
  return usePrimaryAccountAuth() ? <CookieProfileBar /> : <LegacyProfileBar />;
}

function CookieProfileBar() {
  const cookie = useCookieCabinetProfile();
  const profile = cookie?.profile ?? null;
  return <CabinetProfileView data={{
    identity: cookie?.ownerId && profile ? { ownerKey: cookie.ownerId, name: profile.name, email: profile.email } : null,
    profile,
    profileError: cookie?.error ?? (cookie ? undefined : "Не удалось загрузить профиль. Обновите страницу."),
    loading: cookie?.loading ?? false,
    saveProfile: cookie?.saveProfile,
    reloadProfile: cookie?.reload,
  }} />;
}

export function CabinetProfileView({ data }: { data: CabinetProfileData }) {
  const { state: authState, userId } = useAuthState();
  const { identity, profile, profileError, loading, saveProfile, reloadProfile } = data;
  const avatarMemory = useCookieCabinetProfile();
  const retainedAvatar = avatarMemory?.avatarDraft ?? avatarMemory?.avatarPreparation;
  const [open, setOpen] = useState(Boolean(retainedAvatar));
  useEffect(() => { if (retainedAvatar) setOpen(true); }, [retainedAvatar]);
  useEffect(()=>{if(new URLSearchParams(window.location.search).get('settings')==='1')setOpen(true);},[]);

  if (authState !== "signed-in" && authState !== "admin") {
    return null;
  }

  if (!userId || (identity && identity.ownerKey !== userId)) return null;

  if (!loading && profileError && !profile) return <CabinetProfileFailure message={profileError} reload={reloadProfile} />;

  if (loading || !identity || !profile) {
    return null;
  }

  return (
    <section id="cabinet-profile" tabIndex={-1} className="mx-auto mt-4 w-full max-w-3xl scroll-mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:mt-5 sm:p-4">
      {!open && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-lg font-bold text-[#0875d1]">
            {profile.avatarDataUrl ? (
              <Image
                src={profile.avatarDataUrl}
                unoptimized
                width={48}
                height={48}
                alt={`Аватар ${profile.name}`}
                className="h-full w-full object-cover"
                style={{
                  objectPosition: `${profile.avatarPositionX}% ${profile.avatarPositionY}%`,
                  transform: `scale(${profile.avatarZoom})`,
                  transformOrigin: `${profile.avatarPositionX}% ${profile.avatarPositionY}%`,
                }}
              />
            ) : (
              profile.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold uppercase text-[#0a7b2b]">Ваш профиль</p>
            <h2 className="truncate text-xl font-bold text-[#060b27]">{profile.name}</h2>
            <p className="truncate text-sm text-slate-500">{profile.email || "Email не указан"}</p>
            {profile.phone ? (
              <p className={profile.phoneVerified && profile.verifiedPhone === profile.phone ? "mt-1 text-xs font-bold text-[#0a8f32]" : "mt-1 text-xs font-bold text-amber-700"}>
                {profile.phone} · {profile.phoneVerified && profile.verifiedPhone === profile.phone ? "подтвержден" : "не подтвержден"}
              </p>
            ) : null}
          </div>
        </div>
        <button type="button" disabled={Boolean(profileError)} onClick={() => setOpen((value) => !value)} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1] disabled:cursor-not-allowed disabled:opacity-50">
          <Settings2 className="h-4 w-4" />
          Настройки
        </button>
      </div>}
      {profileError ? <p role="alert" className="mt-3 text-sm font-semibold text-amber-700">{profileError}</p> : null}
      {open && !profileError ? <SettingsPanelLoader key={identity.ownerKey} identity={identity} profile={profile} onClose={() => setOpen(false)} saveProfile={saveProfile} /> : null}
    </section>
  );
}
