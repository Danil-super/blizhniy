import { FormPhotoUploader } from "@/components/FormPhotoUploader";
import { ValidatedInput } from "@/components/ValidatedInput";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

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
    <section className="mb-16 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:mb-20 sm:p-6">
      <h1 className="text-2xl font-black leading-tight text-[#060b27] sm:text-4xl">{title}</h1>
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

export function Field({
  defaultValue,
  label,
  name,
  placeholder,
  type = "text",
  ...inputProps
}: {
  defaultValue?: string;
  label: string;
  name?: string;
  placeholder?: string;
  type?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "defaultValue" | "name" | "placeholder" | "type">) {
  const validation = validationForField(label, type);
  const inputClassName = "h-10 w-full min-w-0 max-w-full rounded-xl border border-slate-300 px-3 text-sm font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4 sm:text-base";

  return (
    <label className="grid min-w-0 max-w-full gap-1.5 text-xs font-bold leading-4 text-slate-700 sm:gap-2 sm:text-sm">
      <span className="break-words [overflow-wrap:anywhere]">{label}</span>
      {type === "file" ? (
        <input name={name} className={inputClassName} type={type} placeholder={placeholder} {...inputProps} />
      ) : (
        <ValidatedInput name={name} className={inputClassName} type={type} placeholder={placeholder} validation={validation} defaultValue={defaultValue} {...inputProps} />
      )}
    </label>
  );
}

export function TextAreaField({
  defaultValue,
  label,
  name,
  placeholder,
  ...textareaProps
}: {
  defaultValue?: string;
  label: string;
  name?: string;
  placeholder?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "defaultValue" | "name" | "placeholder">) {
  return (
    <label className="grid min-w-0 max-w-full gap-1.5 text-xs font-bold text-slate-700 sm:gap-2 sm:text-sm">
      {label}
      <textarea
        name={name}
        className="min-h-24 w-full min-w-0 max-w-full rounded-xl border border-slate-300 p-3 text-sm font-normal outline-none focus:border-[#0875d1] sm:min-h-32 sm:p-4 sm:text-base"
        placeholder={placeholder}
        defaultValue={defaultValue}
        {...textareaProps}
      />
    </label>
  );
}

export function PhotoField({ defaultPhotos, label, description }: { defaultPhotos?: string[]; label: string; description: string }) {
  return <FormPhotoUploader label={label} description={description} defaultPhotos={defaultPhotos} />;
}
