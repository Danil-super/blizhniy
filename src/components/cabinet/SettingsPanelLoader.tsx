"use client";

import {useEffect,useState,type ComponentProps} from "react";
import {useCookieCabinetProfile} from "./CookieCabinetProfileProvider";

type Editor = typeof import("./CabinetClient").SettingsPanel;
type Props = ComponentProps<Editor>;

export function SettingsPanelLoader(props: Props) {
  const cookie = useCookieCabinetProfile();
  const [Editor,setEditor] = useState<Editor | null>(null);
  const [failed,setFailed] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void import("./CabinetClient").then(module => {
      if (active) setEditor(() => module.SettingsPanel);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);

  if (Editor) return <Editor {...props} />;
  return <section className="rounded-xl border border-blue-100 bg-white p-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-bold text-slate-950">Настройки аккаунта</h2>
      <button type="button" onClick={() => { cookie?.clearSettingsDraft();props.onClose(); }} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700">Закрыть</button>
    </div>
    {failed ? <div className="mt-3">
      <p role="alert" className="text-sm text-rose-800">Не удалось загрузить настройки. Повторите попытку.</p>
      <button type="button" onClick={() => { setFailed(false);setAttempt(value => value + 1); }} className="mt-3 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-bold text-blue-800">Повторить загрузку</button>
    </div> : <p role="status" className="mt-3 text-sm text-slate-600">Загружаем настройки…</p>}
  </section>;
}
