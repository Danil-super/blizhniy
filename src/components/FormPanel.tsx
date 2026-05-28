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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
      <h1 className="text-2xl font-black text-[#060b27] sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">{description}</p>
      <div className="mt-5 grid gap-3 sm:mt-8 sm:gap-4">{children}</div>
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

export function Field({ label, name, placeholder, type = "text" }: { label: string; name?: string; placeholder?: string; type?: string }) {
  const validation = validationForField(label, type);
  const inputClassName = "h-10 min-w-0 rounded-xl border border-slate-300 px-3 text-sm font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4 sm:text-base";

  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-bold leading-4 text-slate-700 sm:gap-2 sm:text-sm">
      <span className="line-clamp-2">{label}</span>
      {type === "file" ? (
        <input name={name} className={inputClassName} type={type} placeholder={placeholder} />
      ) : (
        <ValidatedInput name={name} className={inputClassName} type={type} placeholder={placeholder} validation={validation} />
      )}
    </label>
  );
}

export function TextAreaField({ label, name, placeholder }: { label: string; name?: string; placeholder?: string }) {
  return (
    <label className="grid gap-1.5 text-xs font-bold text-slate-700 sm:gap-2 sm:text-sm">
      {label}
      <textarea name={name} className="min-h-24 rounded-xl border border-slate-300 p-3 text-sm font-normal outline-none focus:border-[#0875d1] sm:min-h-32 sm:p-4 sm:text-base" placeholder={placeholder} />
    </label>
  );
}

export function PhotoField({ label, description }: { label: string; description: string }) {
  return (
    <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-700">{label}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm sm:leading-6">{description}</p>
        </div>
        <label className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white sm:h-11 sm:px-5">
          Добавить фото
          <input className="sr-only" type="file" accept="image/*" multiple />
        </label>
      </div>
    </section>
  );
}
