"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListingDraftClientError, productionDrafts } from "@/lib/client-listing-drafts";
import { parseListingDraft, type ListingDraftPage } from "@/lib/listing-draft-contract";
import { notifyAccountSessionChange } from "@/lib/local-account";
import { PrivateDraftEditor, draftFields, draftIsDirty, draftButton, type DraftEditorAction, type DraftEditorState } from "./PrivateDraftEditor";
import { useDraftLeaveGuard } from "./useDraftLeaveGuard";
import {usePrivateDraftPhotos} from './usePrivateDraftPhotos';
import {PrivateDraftPhotos} from './PrivateDraftPhotos';
import {PrivateDraftDetails} from './PrivateDraftDetails';
import {usePrivateListingForm} from './usePrivateListingForm';
import {PrivateListingFormEditor} from './PrivateListingFormEditor';
import {PrivateDraftPublicationCheck} from './PrivateDraftPublicationCheck';
import {PrivateDraftModeration} from './PrivateDraftModeration';

export function PrivateDraftWorkspace({ owner, visible, listing = false }: { owner: string; visible: boolean; listing?: boolean }) {
  const [page, setPage] = useState<ListingDraftPage | null>(null), [editor, setEditor] = useState<DraftEditorState | null>(null);
  const [busy, setBusy] = useState<string | null>("Загружаем черновики…"), [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0), pending = useRef<object | null>(null), scope = useRef<AbortController | null>(null), creationKey = useRef<string | null>(null);
  const dirty = draftIsDirty(editor);
  const photoRevision=useCallback((id:string,before:string,after:string)=>{
    setEditor(current=>current?.saved.id===id&&current.saved.revision===before?{...current,saved:{...current.saved,revision:after}}:current);
  },[]);
  const photoConflict=useCallback((id:string)=>{setEditor(current=>current?.saved.id===id?{...current,blocked:true,remote:null}:current);},[]);
  const photos=usePrivateDraftPhotos(owner,editor?.saved.id,editor?.saved.revision,photoRevision,photoConflict);
  const full=usePrivateListingForm(owner,editor?.saved.id);
  const working=!!busy||photos.busy||full.busy;
  useDraftLeaveGuard(dirty || !!editor?.blocked || photos.uncertain || creationKey.current !== null);
  const run = useCallback(async <T,>(label: string, work: (options: { signal?: AbortSignal }) => Promise<T>, apply: (value: T) => void,
    failed?: (error: ListingDraftClientError) => void) => {
    if (pending.current) return;
    const attempt = {}, generation = epoch.current;pending.current = attempt;setBusy(label);
    try {
      const value = await work({ signal: scope.current?.signal });
      if (generation === epoch.current) apply(value);
    } catch (error) {
      if (generation !== epoch.current) return;
      const failure = error instanceof ListingDraftClientError ? error : new ListingDraftClientError("UNKNOWN");
      if (failure.code === "UNAUTHENTICATED" || failure.code === "DRAFT_NOT_FOUND") {
        notifyAccountSessionChange(true);notifyAccountSessionChange(false);
      }
      setMessage(failure.message);failed?.(failure);
    } finally {
      if (pending.current === attempt) { pending.current = null;setBusy(null); }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();scope.current = controller;const generation = ++epoch.current;pending.current = null;
    void run("Загружаем черновики…", options => productionDrafts.list(owner, null, options), setPage);
    return () => { epoch.current = generation+1;pending.current = null;controller.abort(); };
  }, [owner, refresh, run]);

  function create() {
    if (pending.current || photos.busy || photos.uncertain || dirty || editor?.blocked) return;
    try { creationKey.current ??= crypto.randomUUID(); } catch { setMessage("Не удалось подготовить создание. Обновите страницу.");return; }
    const key = creationKey.current;setMessage(null);
    void run("Создаём черновик…", options => productionDrafts.createEmpty(owner, key, options), saved => {
      creationKey.current = null;setEditor({ saved, fields: draftFields(saved.draft), blocked: false, remote: null });
      setMessage("Черновик создан.");setRefresh(value => value+1);
    });
  }
  function open(id: string) {
    if (pending.current || photos.busy || photos.uncertain || dirty || editor?.blocked || creationKey.current) return;
    setMessage(null);
    void run("Открываем черновик…", options => productionDrafts.read(owner, id, options), saved => {
      setEditor({ saved, fields: draftFields(saved.draft), blocked: false, remote: null });
    });
  }
  function action(name: DraftEditorAction) {
    if (!editor || pending.current || photos.busy) return;
    if (name === "close") {
      if ((dirty || editor.blocked || photos.uncertain) && !window.confirm("Закрыть редактор с несохранёнными или неподтверждёнными правками? Отправленный запрос при этом не отменяется.")) return;
      setEditor(null);setMessage(null);return;
    }
    if ((name === "remote" || name === "local") && editor.remote) {
      setEditor({ saved: editor.remote, fields: name === "remote" ? draftFields(editor.remote.draft) : editor.fields, blocked: false, remote: null });
      setMessage("Версия сверена. Проверьте поля перед следующим сохранением.");return;
    }
    if (name === "readback") {
      void run("Проверяем сохранённую версию…", options => productionDrafts.read(owner, editor.saved.id, options), remote => {
        setEditor(current => current ? { ...current, remote } : null);setMessage("Сравните сохранённую версию с вашими правками.");
      });return;
    }
    if (name !== "save" || editor.blocked || !dirty) return;
    let draft;
    try { draft = parseListingDraft({ ...editor.saved.draft, kind: editor.fields.kind, title: editor.fields.title, description: editor.fields.description,
      price: editor.fields.priceText.trim() ? editor.fields.priceText.trim().replace(",", ".") : null }); }
    catch { setMessage("Проверьте название, описание и цену. Цену можно оставить пустой или указать число с двумя знаками после запятой.");return; }
    setMessage(null);
    void run("Сохраняем черновик…", options => productionDrafts.write(owner, editor.saved.id, editor.saved.revision, draft, options), saved => {
      setEditor({ saved, fields: draftFields(saved.draft), blocked: false, remote: null });setMessage("Черновик сохранён.");setRefresh(value => value+1);
    }, error => {
      if (error.code !== "INVALID_INPUT" && error.code !== "RATE_LIMITED") setEditor(current => current ? { ...current, blocked: true, remote: null } : null);
    });
  }
  // Keep unsaved text in this owner-keyed component during a session recheck, never in hidden DOM.
  if (!visible) return null;
  return <div>
    <div className="mt-5 flex flex-wrap gap-3">
      {listing ? <Link href="/razmestit/obyavlenie" className={`${draftButton} inline-flex items-center bg-[#0875d1] text-white`}>Создать объявление</Link> : <button type="button" className={`${draftButton} bg-[#0875d1] text-white`} disabled={working || !!full.editor || photos.uncertain || dirty || !!editor?.blocked} onClick={create}>
        {creationKey.current ? "Проверить создание" : "Новый черновик"}
      </button>}
      <button type="button" className={draftButton} disabled={working||!!full.editor} onClick={() => { setMessage(null);setRefresh(value => value+1); }}>Обновить список</button>
    </div>
    {busy && <p className="mt-4" role="status">{busy}</p>}
    {full.busy&&!full.editor&&<p className="mt-4" role="status">Загружаем дополнительные поля…</p>}
    {message && <p className="mt-4 rounded-lg border border-slate-300 bg-white p-3" role="status">{message}</p>}
    {page && <section className="mt-6" aria-label={listing ? "Сохранённые объявления" : "Ваши черновики"}>
      <h2 className="text-xl font-bold">{listing ? "Сохранённые объявления" : "Ваши черновики"}</h2>
      {page.items.length === 0 ? <p className="mt-3">{listing ? "Объявлений пока нет." : "Черновиков пока нет."}</p> : <ul className="mt-3 divide-y divide-slate-200">
        {page.items.map(item => <li key={item.id}><button type="button" className="min-h-11 w-full break-words px-2 py-3 text-left font-semibold underline underline-offset-4 disabled:opacity-50"
          disabled={working || !!full.editor || photos.uncertain || dirty || !!editor?.blocked || creationKey.current !== null} onClick={() => open(item.id)}>{item.title || "Без названия"}</button></li>)}
      </ul>}
      {page.nextCursor && <button type="button" className={`${draftButton} mt-3`} disabled={working||!!full.editor} onClick={() => {
        void run("Загружаем следующую страницу…", options => productionDrafts.list(owner, page.nextCursor, options), setPage);
      }}>Следующая страница</button>}
    </section>}
    {editor && !full.editor && <PrivateDraftEditor editor={editor} busy={working} onAction={action} onChange={fields => {
      setEditor(current => current ? { ...current, fields: { ...current.fields, ...fields } } : null);
    }} />}
    {editor&&!full.editor&&<PrivateDraftPhotos owner={owner} photos={photos} disabled={!!busy||full.busy||editor.blocked}/>}
    {editor&&!full.editor&&<PrivateDraftDetails owner={owner} id={editor.saved.id} revision={editor.saved.revision}
      disabled={working||photos.uncertain||dirty||editor.blocked} onEdit={full.open}/>}
    {editor&&!full.editor&&<PrivateDraftPublicationCheck owner={owner} id={editor.saved.id} revision={editor.saved.revision}
      disabled={working||photos.uncertain||dirty||editor.blocked}/>}
    {editor&&!full.editor&&<PrivateDraftModeration key={`${owner}:${editor.saved.id}:${editor.saved.revision}`} owner={owner} id={editor.saved.id} revision={editor.saved.revision}
      disabled={working||photos.uncertain||dirty||editor.blocked}/>}
    {!full.editor&&full.message&&<p className="mt-3" role="status">{full.message}</p>}
    {full.editor&&<PrivateListingFormEditor edit={full} onClose={()=>{if(full.close()){setEditor(null);setMessage(null);setRefresh(value=>value+1);}}}/>}
  </div>;
}
