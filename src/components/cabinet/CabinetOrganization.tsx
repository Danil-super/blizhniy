"use client";
import {useEffect,useState,type FormEvent} from "react";
import type {CabinetProfile} from "@/lib/cabinet-profile";
import {CabinetFormValidation} from "@/components/CabinetFormValidation";
import {CabinetProfileFailure,useCookieCabinetProfile} from "./CookieCabinetProfileProvider";
import type {CabinetProfileData} from "./CabinetProfileBar";

export function CookieCabinetOrganization(){
 const cookie=useCookieCabinetProfile(),profile=cookie?.profile??null;
 return <CabinetOrganizationView key={cookie?.ownerId??"unresolved"} data={{
  identity:cookie?.ownerId&&profile?{ownerKey:cookie.ownerId,name:profile.name,email:profile.email}:null,
  profile,loading:cookie?.loading??false,profileError:cookie?.error??(cookie?undefined:"Не удалось загрузить профиль. Обновите страницу."),
  saveProfile:cookie?.saveProfile,reloadProfile:cookie?.reload,
 }}/>;
}

export function CabinetOrganizationView({data}: {data: CabinetProfileData}) {
  const { identity, profile, profileError, loading, saveProfile, reloadProfile } = data;
  const [form, setForm] = useState<CabinetProfile | null>(profile);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  if (!loading && profileError && !profile) return <CabinetProfileFailure message={profileError} reload={reloadProfile} />;
  if (loading || !identity || !profile || !form) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">Загружаем профиль...</div>;
  }

  const completedFields = [form.organizationName, form.organizationInn, form.organizationAddress, form.organizationDescription].filter((value) => value.trim()).length;
  const completionLabel = completedFields >= 3 ? "Заполнен" : completedFields > 0 ? "Нужно дополнить" : "Не заполнен";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity || !form) {
      return;
    }

    if (profileError) {
      setMessage("Профиль не загружен. Обновите страницу перед сохранением.");
      return;
    }

    const organizationName = form.organizationName.trim();
    const organizationInn = form.organizationInn.replace(/\D/g, "");
    const organizationOgrn = form.organizationOgrn.replace(/\D/g, "");

    if (!organizationName) {
      setMessage("Укажите название организации или ИП.");
      return;
    }

    if (organizationInn && organizationInn.length !== 10 && organizationInn.length !== 12) {
      setMessage("ИНН должен содержать 10 цифр для организации или 12 цифр для ИП.");
      return;
    }

    if (organizationOgrn && organizationOgrn.length !== 13 && organizationOgrn.length !== 15) {
      setMessage("ОГРН должен содержать 13 цифр, ОГРНИП — 15 цифр.");
      return;
    }

    const nextProfile: CabinetProfile = {
      ...form,
      organizationName: organizationName.slice(0, 120),
      organizationInn,
      organizationOgrn,
      organizationAddress: form.organizationAddress.trim().slice(0, 160),
      organizationWebsite: form.organizationWebsite.trim().slice(0, 120),
      organizationDescription: form.organizationDescription.trim().slice(0, 500),
    };

    setSaving(true);
    setMessage("");

    try {
      if (!saveProfile) throw new Error("Не удалось сохранить профиль организации.");
      const saved = await saveProfile(nextProfile);
      setForm(saved);
      setMessage("Профиль организации сохранен.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить профиль организации.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#060b27]">{form.organizationName || "Профиль организации"}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Заполните данные работодателя один раз, чтобы при размещении вакансий было понятно, от чьего имени публикуется предложение.
          </p>
        </div>
        <span className="inline-flex h-7 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-[#0a7b2b]">{completionLabel}</span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Город</p>
          <p className="mt-2 font-bold text-[#060b27]">{profile.city}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Телефон</p>
          <p className="mt-2 font-bold text-[#060b27]">{profile.phone || "Не указан"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Email</p>
          <p className="mt-2 break-words font-bold text-[#060b27]">{profile.email || "Не указан"}</p>
        </div>
      </div>
      {profileError ? <p role="alert" className="mt-4 text-sm font-semibold text-amber-700">{profileError}</p> : null}
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
        <CabinetFormValidation/>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            Название организации или ИП
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationName}
              name="organizationName"
              onChange={(event) => setForm({ ...form, organizationName: event.target.value.slice(0, 120) })}
              placeholder="ООО РемДом"
              minLength={2}
              maxLength={120}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            Сайт или профиль
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationWebsite}
              name="organizationWebsite"
              type="url"
              onChange={(event) => setForm({ ...form, organizationWebsite: event.target.value.slice(0, 120) })}
              placeholder="https://example.ru"
              maxLength={120}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            ИНН
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationInn}
              name="organizationInn"
              pattern="([0-9]{10}|[0-9]{12})"
              onChange={(event) => setForm({ ...form, organizationInn: event.target.value.replace(/\D/g, "").slice(0, 12) })}
              placeholder="10 или 12 цифр"
              inputMode="numeric"
              maxLength={12}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            ОГРН / ОГРНИП
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationOgrn}
              name="organizationOgrn"
              pattern="([0-9]{13}|[0-9]{15})"
              onChange={(event) => setForm({ ...form, organizationOgrn: event.target.value.replace(/\D/g, "").slice(0, 15) })}
              placeholder="13 или 15 цифр"
              inputMode="numeric"
              maxLength={15}
            />
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          Адрес
          <input
            className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
            value={form.organizationAddress}
            name="organizationAddress"
            onChange={(event) => setForm({ ...form, organizationAddress: event.target.value.slice(0, 160) })}
            placeholder="Краснодар, ул. Красная, 1"
            maxLength={160}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          Краткое описание
          <textarea
            className="min-h-28 resize-y rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none focus:border-[#0875d1]"
            value={form.organizationDescription}
            name="organizationDescription"
            onChange={(event) => setForm({ ...form, organizationDescription: event.target.value.slice(0, 500) })}
            placeholder="Чем занимается компания, кого обычно нанимаете, важные условия для соискателей."
            maxLength={500}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || Boolean(profileError)} className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-wait disabled:opacity-60">
            {saving ? "Сохраняем..." : "Сохранить профиль организации"}
          </button>
          {message ? <p className="text-sm font-semibold text-slate-600">{message}</p> : null}
        </div>
      </form>
    </section>
  );
}
