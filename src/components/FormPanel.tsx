import { ValidatedInput } from "@/components/ValidatedInput";

export function FormPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
      <h1 className="text-4xl font-black text-[#060b27]">{title}</h1>
      <p className="mt-3 max-w-3xl leading-7 text-slate-600">{description}</p>
      <div className="mt-8 grid gap-4">{children}</div>
    </section>
  );
}

function validationForField(label: string, type: string) {
  const normalizedLabel = label.toLowerCase();

  if (normalizedLabel.includes("телефон")) {
    return "phone";
  }

  if (normalizedLabel.includes("telegram") || normalizedLabel.includes("whatsapp")) {
    return "messenger";
  }

  if (type === "email" || normalizedLabel.includes("email")) {
    return "email";
  }

  return undefined;
}

export function Field({ label, placeholder, type = "text" }: { label: string; placeholder?: string; type?: string }) {
  const validation = validationForField(label, type);
  const inputClassName = "h-12 rounded-xl border border-slate-300 px-4 font-normal outline-none focus:border-[#0875d1]";

  return (
    <label className="grid gap-2 text-sm font-bold text-slate-700">
      {label}
      {type === "file" ? <input className={inputClassName} type={type} placeholder={placeholder} /> : <ValidatedInput className={inputClassName} type={type} placeholder={placeholder} validation={validation} />}
    </label>
  );
}

export function TextAreaField({ label, placeholder }: { label: string; placeholder?: string }) {
  return (
    <label className="grid gap-2 text-sm font-bold text-slate-700">
      {label}
      <textarea className="min-h-32 rounded-xl border border-slate-300 p-4 font-normal outline-none focus:border-[#0875d1]" placeholder={placeholder} />
    </label>
  );
}

export function PhotoField({ label, description }: { label: string; description: string }) {
  return (
    <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-700">{label}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        <label className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#0875d1] px-5 text-sm font-bold text-white">
          Добавить фото
          <input className="sr-only" type="file" accept="image/*" multiple />
        </label>
      </div>
    </section>
  );
}
