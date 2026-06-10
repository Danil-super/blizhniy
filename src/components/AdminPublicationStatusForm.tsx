"use client";

import type { FormEvent } from "react";
import type { PublicationStatus } from "@/lib/types";

type StatusOption = {
  label: string;
  value: PublicationStatus;
};

type AdminPublicationStatusFormProps = {
  entityType: string;
  id: string;
  status: string;
  options: StatusOption[];
  updateStatusAction: (formData: FormData) => void | Promise<void>;
};

export function AdminPublicationStatusForm({ entityType, id, status, options, updateStatusAction }: AdminPublicationStatusFormProps) {
  function closeMenu(event: FormEvent<HTMLFormElement>) {
    const details = event.currentTarget.closest("details");

    if (details) {
      details.open = false;
    }
  }

  return (
    <form action={updateStatusAction} onSubmit={closeMenu} className="grid gap-2 rounded-md border-t border-slate-100 px-3 py-2">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="id" value={id} />
      <label className="grid gap-1 text-xs font-semibold text-slate-600">
        Статус
        <select name="status" defaultValue={status} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none focus:border-[#0875d1]">
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="inline-flex h-8 items-center justify-center rounded-md bg-[#0875d1] px-3 text-xs font-bold text-white transition hover:bg-[#0664b3]">
        Сохранить статус
      </button>
    </form>
  );
}
