"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePrimaryAccountAuth } from "@/components/auth/AccountAuthProvider";
import type { AccountAuthSnapshot } from "@/lib/account-session-state";
import type { CabinetProfile } from "@/lib/cabinet-profile";
import { CookieProfileError, productionProfile } from "@/lib/client-postgres-profile";
import { notifyAccountSessionChange } from "@/lib/local-account";

type Snapshot = { ownerId: string | null; profile: CabinetProfile | null; revision?: string | null; conflict?: boolean; error?: string; loading: boolean };
export type AvatarCropSelection = {draft:{src:string;zoom:number;offsetX:number;offsetY:number};imageSize:{width:number;height:number}};
type AvatarPreparation = {loading:boolean;message:string};
type Value = Snapshot & { saveProfile: (profile: CabinetProfile) => Promise<CabinetProfile>; reload: () => void;
  refreshVerifiedPhone: () => Promise<void>;
  settingsDraft: CabinetProfile | null; setSettingsDraft: (profile: CabinetProfile) => void; clearSettingsDraft: () => void;
  avatarDraft: AvatarCropSelection|null; setAvatarDraft:(value:AvatarCropSelection|null)=>void;
  avatarPreparation:AvatarPreparation|null;
  prepareAvatarSelection:(prepare:()=>Promise<AvatarCropSelection>)=>Promise<AvatarCropSelection|null> };
const Context = createContext<Value | null>(null);
const empty: Snapshot = { ownerId: null, profile: null, loading: true };
export function useCookieCabinetProfile() { return useContext(Context); }

function ProfileScope({ auth, children }: { auth: AccountAuthSnapshot; children: ReactNode }) {
  const owner = auth.state === "signed-in" || auth.state === "admin" ? auth.userId : null;
  const latestOwner = useRef(owner); latestOwner.current = owner;
  const version = useRef(0), pendingWrite = useRef<object | null>(null), scope = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  // Unsaved settings belong to this owner, not to the temporary form DOM. Never
  // persist private input in browser storage or carry it through a real logout.
  const [settings, setSettings] = useState<{ owner: string; profile: CabinetProfile; revision: string | null } | null>(null);
  const [avatar, setAvatar] = useState<{owner:string;value:AvatarCropSelection}|null>(null);
  const [avatarPreparation, setAvatarPreparation] = useState<{owner:string;value:AvatarPreparation}|null>(null);
  const avatarEpoch = useRef(0), avatarOwner = useRef(owner);
  // A temporary check hides private state without discarding the selection.
  // Logout, account changes and newer selections invalidate detached decoders.
  if (auth.state === "signed-out" || (owner && avatarOwner.current !== owner)) {
    avatarEpoch.current++;
    avatarOwner.current = owner;
    if (avatarPreparation) setAvatarPreparation(null);
  }
  if (settings && (auth.state === "signed-out" || (owner && owner !== settings.owner))) setSettings(null);
  if (avatar && (auth.state === "signed-out" || (owner && owner !== avatar.owner))) setAvatar(null);
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

  const staleSettings = !!owner && settings?.owner === owner && snapshot.ownerId === owner &&
    snapshot.revision !== undefined && settings.revision !== snapshot.revision;
  const conflict = snapshot.conflict || staleSettings;
  async function saveProfile(profile: CabinetProfile): Promise<CabinetProfile> {
    if (!owner || latestOwner.current !== owner || snapshot.ownerId !== owner || !snapshot.profile || snapshot.loading || snapshot.error) {
      throw new CookieProfileError("SESSION_CHANGED");
    }
    if (conflict) throw new CookieProfileError("PROFILE_CHANGED");
    if (snapshot.revision === undefined) throw new CookieProfileError("UNKNOWN");
    if (pendingWrite.current) throw new Error("Сохранение профиля уже выполняется.");
    const generation = ++version.current, attempt = {};
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
  function clearSettingsDraft() {
    if (!owner || latestOwner.current !== owner) return;
    setSettings(null);
    avatarEpoch.current++;
    setAvatarPreparation(null);
    setAvatar(null);
  }
  function reload() {
    if (conflict) clearSettingsDraft();
    notifyAccountSessionChange(false);
  }
  async function refreshVerifiedPhone() {
    if (!owner || latestOwner.current !== owner || !snapshot.profile || snapshot.loading || pendingWrite.current) throw new CookieProfileError('SESSION_CHANGED');
    if (conflict) throw new CookieProfileError('PROFILE_CHANGED');
    const before=snapshot, generation=version.current;
    const saved=await productionProfile.read(owner,{signal:scope.current?.signal});
    if (generation!==version.current || latestOwner.current!==owner || pendingWrite.current) throw new CookieProfileError('SESSION_CHANGED');
    const withoutPhone=(profile:CabinetProfile)=>Object.fromEntries(Object.entries(profile).filter(([key])=>!['phone','phoneVerified','verifiedPhone'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
    if (JSON.stringify(withoutPhone(before.profile!))!==JSON.stringify(withoutPhone(saved.profile))) {
      setSnapshot({...before,conflict:true,error:'Профиль изменён в другой вкладке. Несохранённые поля сохранены в этой форме.'});
      throw new CookieProfileError('PROFILE_CHANGED');
    }
    setSnapshot({ownerId:owner,...saved,loading:false});
    setSettings(current=>current?.owner===owner?{...current,revision:saved.revision,profile:{...current.profile,phone:saved.profile.phone,
      phoneVerified:saved.profile.phoneVerified,verifiedPhone:saved.profile.verifiedPhone}}:current);
  }
  async function prepareAvatarSelection(prepare:()=>Promise<AvatarCropSelection>):Promise<AvatarCropSelection|null> {
    if (!owner || latestOwner.current !== owner || avatarOwner.current !== owner) return null;
    const attempt = ++avatarEpoch.current;
    setAvatar(null);
    setAvatarPreparation({owner,value:{loading:true,message:""}});
    const current = () => attempt === avatarEpoch.current && avatarOwner.current === owner;
    try {
      const value = await prepare();
      if (!current()) return null;
      setAvatar({owner,value});
      setAvatarPreparation(null);
      return value;
    } catch (error) {
      const known = ["Не удалось прочитать файл.","Не удалось подготовить изображение.",
        "Выберите изображение в формате PNG, JPG или WebP."];
      const message = error instanceof Error && known.includes(error.message) ? error.message
        : "Не удалось открыть изображение. Выберите исправный файл PNG, JPG, WebP или SVG.";
      if (current()) setAvatarPreparation({owner,value:{loading:false,message}});
      return null;
    }
  }
  return <Context.Provider value={{ ...visible, conflict: owner && visible.profile ? conflict : undefined, saveProfile, reload, refreshVerifiedPhone,
    settingsDraft: owner && settings?.owner === owner ? settings.profile : null,
    setSettingsDraft: profile => {
      const revision = visible.revision;
      if (!owner || latestOwner.current !== owner || revision === undefined) return;
      setSettings(current => ({owner, profile, revision: current?.owner === owner ? current.revision : revision}));
    },
    clearSettingsDraft,
    // Selection is private, owner-scoped UI memory, never a saved profile or a
    // write authorization. Unknown writes still require a fresh profile read.
    avatarDraft: owner&&avatar?.owner===owner?avatar.value:null,
    setAvatarDraft:value=>{if(owner&&latestOwner.current===owner){
      avatarEpoch.current++;setAvatarPreparation(null);setAvatar(value?{owner,value}:null);
    }},
    avatarPreparation:owner&&avatarPreparation?.owner===owner?avatarPreparation.value:null,
    prepareAvatarSelection }}>
    {visible.profile && conflict ? <CabinetProfileFailure message="Профиль изменён в другой вкладке. Скопируйте несохранённые изменения и обновите профиль." reload={reload} /> : null}
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
