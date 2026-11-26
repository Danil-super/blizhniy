"use client";
import {useEffect,useId,useState,type FormEvent} from "react";
import type {CabinetProfile,OrganizationField} from "@/lib/cabinet-profile";
import {CabinetFormValidation} from "@/components/CabinetFormValidation";
import {CabinetProfileFailure,useCookieCabinetProfile} from "./CookieCabinetProfileProvider";
import type {CabinetProfileData} from "./CabinetProfileBar";

const organizationLabels: Record<OrganizationField,string> = {
  organizationName: "Название организации или ИП",
  organizationInn: "ИНН",
  organizationOgrn: "ОГРН / ОГРНИП",
  organizationAddress: "Адрес",
  organizationWebsite: "Сайт или профиль",
  organizationDescription: "Краткое описание",
};
const organizationFields = Object.keys(organizationLabels) as OrganizationField[];

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
  const cookie = useCookieCabinetProfile();
  const primary = Boolean(cookie);
  const [legacyForm, setLegacyForm] = useState<CabinetProfile | null>(profile);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const descriptionId = useId();

  useEffect(() => {
    if (!primary) setLegacyForm(profile);
  }, [primary, profile]);

  if (!loading && profileError && !profile) return <CabinetProfileFailure message={profileError} reload={reloadProfile} />;
  if (loading || !identity || !profile || (!primary && !legacyForm)) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600 shadow-card">Загружаем профиль...</div>;
  }

  const savedProfile = profile;
  const draft = cookie?.organizationDraft;
  const form = { ...(primary ? profile : legacyForm ?? profile) };
  const changedFields = organizationFields.filter(field => draft?.[field] !== undefined);
  for (const field of changedFields) {
    form[field] = draft?.[field]?.value ?? savedProfile[field];
  }
  const conflicts = changedFields.filter(field => draft?.[field]?.original !== savedProfile[field] && form[field].trim() !== savedProfile[field]);
  const matchesSaved = changedFields.length > 0 && changedFields.every(field => form[field].trim() === savedProfile[field]);

  function changeField(field: OrganizationField, value: string) {
    if (!cookie) {
      setLegacyForm({ ...form, [field]: value });
      return;
    }
    cookie.updateOrganizationDraft(current => {
      const next = { ...current };
      if (value === savedProfile[field]) delete next[field];
      else next[field] = { original: current[field]?.original ?? savedProfile[field], value };
      return next;
    });
    setMessage("");
  }

  function settleConflicts(keepInput: boolean) {
    cookie?.updateOrganizationDraft(current => {
      const next = { ...current };
      for (const field of conflicts) {
        const edit = current[field];
        if (keepInput && edit) next[field] = { ...edit, original: savedProfile[field] };
        else delete next[field];
      }
      return next;
    });
  }

  const completedFields = [form.organizationName, form.organizationInn, form.organizationAddress, form.organizationDescription].filter((value) => value.trim()).length;
  const completionLabel = completedFields >= 3 ? "Заполнен" : completedFields > 0 ? "Нужно дополнить" : "Не заполнен";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (conflicts.length) {
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
      if (!matchesSaved) {
        const saved = await saveProfile(nextProfile);
        if (!cookie) setLegacyForm(saved);
      }
      cookie?.updateOrganizationDraft(current => current === draft ? {} : current);
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
      {conflicts.length > 0 && <div role="group" aria-label="Сверка реквизитов" className="mt-4 grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
        <p className="font-semibold">Эти поля были изменены после того, как вы начали редактирование.</p>
        <dl className="grid gap-2">
          {conflicts.map(field => <div key={field} className="min-w-0 break-words">
            <dt className="font-semibold">{organizationLabels[field]}</dt>
            <dd>В профиле <span className="whitespace-pre-wrap">{savedProfile[field] || "Не заполнено"}</span></dd>
            <dd>Ваш ввод <span className="whitespace-pre-wrap">{form[field] || "Не заполнено"}</span></dd>
          </div>)}
        </dl>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => settleConflicts(false)} className="min-h-11 rounded-lg border border-slate-400 bg-white px-3 py-2 font-semibold">Использовать сохранённые значения</button>
          <button type="button" onClick={() => settleConflicts(true)} className="min-h-11 rounded-lg border border-slate-400 bg-white px-3 py-2 font-semibold">Оставить мой ввод</button>
        </div>
      </div>}
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
        <CabinetFormValidation/>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            Название организации или ИП
            <input
              className="h-11 min-w-0 rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-[#0875d1]"
              value={form.organizationName}
              name="organizationName"
              onChange={(event) => changeField("organizationName", event.target.value.slice(0, 120))}
              disabled={saving}
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
              onChange={(event) => changeField("organizationWebsite", event.target.value.slice(0, 120))}
              disabled={saving}
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
              onChange={(event) => changeField("organizationInn", event.target.value.replace(/\D/g, "").slice(0, 12))}
              disabled={saving}
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
              onChange={(event) => changeField("organizationOgrn", event.target.value.replace(/\D/g, "").slice(0, 15))}
              disabled={saving}
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
            onChange={(event) => changeField("organizationAddress", event.target.value.slice(0, 160))}
            disabled={saving}
            placeholder="Краснодар, ул. Красная, 1"
            maxLength={160}
          />
        </label>
        <div className="grid gap-1.5 text-sm text-slate-700">
          <label htmlFor={descriptionId} className="font-bold">Краткое описание</label>
          <textarea
            id={descriptionId}
            className="min-h-28 resize-y rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none focus:border-[#0875d1]"
            value={form.organizationDescription}
            name="organizationDescription"
            onChange={(event) => changeField("organizationDescription", event.target.value.slice(0, 500))}
            disabled={saving}
            placeholder="Чем занимается компания, кого обычно нанимаете, важные условия для соискателей."
            maxLength={500}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || Boolean(profileError) || conflicts.length > 0} className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-wait disabled:opacity-60">
            {saving ? "Сохраняем..." : "Сохранить профиль организации"}
          </button>
          {message || matchesSaved ? <p role="status" className="text-sm font-semibold text-slate-600">{message || "Введённые реквизиты совпадают с сохранёнными."}</p> : null}
        </div>
      </form>
    </section>
  );
}
