"use client";
import { useEffect, useRef } from "react";
import type { ListingDraftInput, ListingDraftSnapshot } from "@/lib/listing-draft-contract";

export type DraftFields = Pick<ListingDraftInput, "kind" | "title" | "description"> & { priceText: string };
export type DraftEditorState = { saved: ListingDraftSnapshot; fields: DraftFields; blocked: boolean; remote: ListingDraftSnapshot | null };
export type DraftEditorAction = "save" | "readback" | "remote" | "local" | "close";
export function draftFields(draft: ListingDraftInput): DraftFields {
  return { kind: draft.kind, title: draft.title, description: draft.description, priceText: draft.price?.replace(".", ",") ?? "" };
}
export function draftIsDirty(editor: DraftEditorState | null): boolean {
  return !!editor && JSON.stringify(editor.fields) !== JSON.stringify(draftFields(editor.saved.draft));
}
export const draftButton = "min-h-11 rounded-lg border border-slate-500 px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const field = "mt-1 min-h-11 w-full rounded-lg border border-slate-500 bg-white p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700";
const kinds = [{ value: "prodam", label: "Продам" }, { value: "kuplyu", label: "Куплю" },
  { value: "otdam-darom", label: "Отдам даром" }, { value: "arenda", label: "Аренда" }] as const;

export function PrivateDraftEditor({ editor, busy, onAction, onChange }: { editor: DraftEditorState; busy: boolean;
  onAction: (action: DraftEditorAction) => void; onChange: (fields: Partial<DraftFields>) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [editor.saved.id]);
  return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="draft-editor-heading">
    <h2 id="draft-editor-heading" tabIndex={-1} ref={heading} className="text-xl font-bold">Текст черновика</h2>
    <p className="mt-2 text-sm text-slate-600">Черновик виден только вам. Сохранение не публикует объявление и не запускает оплату.</p>
    <form className="mt-4" onSubmit={event => { event.preventDefault();onAction("save"); }}>
      <fieldset disabled={busy} className="grid min-w-0 gap-4">
        <legend className="sr-only">Основные поля черновика</legend>
        <div><label htmlFor="draft-kind">Тип объявления</label><select id="draft-kind" value={editor.fields.kind} className={field} onChange={event => {
          const kind = kinds.find(item => item.value === event.currentTarget.value);if (kind) onChange({ kind: kind.value });
        }}>{kinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <div><label htmlFor="draft-title">Название</label><input id="draft-title" maxLength={160} className={field} value={editor.fields.title}
          onChange={event => onChange({ title: event.currentTarget.value })} /></div>
        <div><label htmlFor="draft-description">Описание</label><textarea id="draft-description" maxLength={10000} rows={6} className={field}
          value={editor.fields.description} onChange={event => onChange({ description: event.currentTarget.value })} /></div>
        <div><label htmlFor="draft-price">Цена, ₽</label><input id="draft-price" inputMode="decimal" maxLength={13} className={field}
          placeholder="Например, 1200,00" value={editor.fields.priceText} onChange={event => onChange({ priceText: event.currentTarget.value })} /></div>
        <button type="submit" disabled={!draftIsDirty(editor) || editor.blocked} className={`${draftButton} bg-[#0875d1] text-white`}>Сохранить черновик</button>
      </fieldset>
    </form>
    {editor.blocked && <div className="mt-4 space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4">
      <p>Сохранение не подтверждено или версия изменилась. Ваши правки оставлены в редакторе. Перед следующим сохранением сверьте данные.</p>
      <button type="button" disabled={busy} className={draftButton} onClick={() => onAction("readback")}>Проверить сохранённую версию</button>
    </div>}
    {editor.remote && <section className="mt-4 space-y-3 rounded-lg border border-slate-300 p-4" aria-label="Сохранённая версия">
      <h3 className="font-bold">Сохранённая версия</h3>
      <p>Тип: {kinds.find(item => item.value === editor.remote?.draft.kind)?.label}</p>
      <p className="break-words font-semibold">{editor.remote.draft.title || "Без названия"}</p>
      <p className="whitespace-pre-wrap break-words">{editor.remote.draft.description || "Описание не заполнено."}</p>
      <p>Цена: {editor.remote.draft.price ? `${editor.remote.draft.price} ₽` : "не указана"}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} className={draftButton} onClick={() => onAction("remote")}>Принять сохранённую версию</button>
        <button type="button" disabled={busy} className={draftButton} onClick={() => onAction("local")}>Продолжить с моими правками</button>
      </div>
    </section>}
    <button type="button" disabled={busy} className={`${draftButton} mt-4`} onClick={() => onAction("close")}>Закрыть редактор</button>
  </section>;
}
