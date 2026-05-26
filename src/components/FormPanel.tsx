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

  return (
    <label className="grid gap-2 text-sm font-bold text-slate-700">
      {label}
      <ValidatedInput className="h-12 rounded-xl border border-slate-300 px-4 font-normal outline-none focus:border-[#0875d1]" type={type} placeholder={placeholder} validation={validation} />
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
