import { CapitalizedTextarea } from "@/components/CapitalizedTextarea";
import { FormPhotoUploader } from "@/components/FormPhotoUploader";
import { ValidatedInput } from "@/components/ValidatedInput";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type FieldSize = "xs" | "sm" | "md" | "lg" | "full";

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
    <section className="mb-16 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-card sm:mb-20 sm:p-6">
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

  if (normalizedLabel === "оплата" || normalizedLabel === "стоимость работ") {
    return "salary";
  }

  if (normalizedLabel.includes("email") && normalizedLabel.includes("мессенджер")) {
    return "emailOrMessenger";
  }

  if (normalizedLabel.includes("соцсеть") || normalizedLabel.includes("сайт")) {
    return "urlOrHandle";
  }

  if (normalizedLabel.includes("telegram") || normalizedLabel.includes("whatsapp")) {
    return "messenger";
  }

  if (type === "email" || normalizedLabel.includes("email")) {
    return "email";
  }

  return undefined;
}

function shouldCapitalizeTextField(type: string, validation?: ReturnType<typeof validationForField>) {
  return !validation && (type === "text" || type === "search");
}

function numericMaxLength(value: InputHTMLAttributes<HTMLInputElement>["maxLength"]) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function fieldSizeFor({
  label,
  maxLength,
  name,
  type,
  validation,
}: {
  label: string;
  maxLength?: InputHTMLAttributes<HTMLInputElement>["maxLength"];
  name?: string;
  type: string;
  validation?: ReturnType<typeof validationForField>;
}): FieldSize {
  const normalized = `${label} ${name ?? ""}`.toLowerCase();
  const length = numericMaxLength(maxLength);

  if (validation === "phone" || validation === "salary" || normalized.includes("график") || normalized.includes("инн") || normalized.includes("огрн")) {
    return "sm";
  }

  if (validation === "email" || validation === "emailOrMessenger" || validation === "messenger" || validation === "urlOrHandle" || validation === "url") {
    return "lg";
  }

  if (type !== "text" && type !== "search") {
    return "md";
  }

  if (normalized.includes("название") || normalized.includes("организац") || normalized.includes("работодатель")) {
    return "lg";
  }

  if (!length) {
    return "md";
  }

  if (length <= 16) {
    return "xs";
  }

  if (length <= 32) {
    return "sm";
  }

  if (length <= 70) {
    return "md";
  }

  if (length <= 120) {
    return "lg";
  }

  return "full";
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
  const capitalizeFirstLetter = shouldCapitalizeTextField(type, validation);
  const fieldSize = fieldSizeFor({ label, maxLength: inputProps.maxLength, name, type, validation });
  const inputClassName = "h-10 w-full min-w-0 max-w-full rounded-xl border border-slate-300 px-3 text-sm font-normal outline-none focus:border-[#0875d1] sm:h-12 sm:px-4 sm:text-base";

  return (
    <label className="form-field grid min-w-0 max-w-full gap-1.5 text-xs font-bold leading-4 text-slate-700 sm:gap-2 sm:text-sm" data-field-size={fieldSize}>
      <span className="break-words [overflow-wrap:anywhere]">{label}</span>
      {type === "file" ? (
        <input name={name} className={inputClassName} type={type} placeholder={placeholder} {...inputProps} />
      ) : validation === "salary" ? (
        <span className="relative block">
          <ValidatedInput
            name={name}
            className={`${inputClassName} pr-10`}
            type={type}
            placeholder={placeholder}
            validation={validation}
            defaultValue={defaultValue}
            capitalizeFirstLetter={capitalizeFirstLetter}
            {...inputProps}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-sm font-black text-slate-500 sm:right-4 sm:text-base">₽</span>
        </span>
      ) : (
        <ValidatedInput name={name} className={inputClassName} type={type} placeholder={placeholder} validation={validation} defaultValue={defaultValue} capitalizeFirstLetter={capitalizeFirstLetter} {...inputProps} />
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
    <label className="form-field grid min-w-0 max-w-full gap-1.5 text-xs font-bold text-slate-700 sm:gap-2 sm:text-sm" data-field-size="full">
      {label}
      <CapitalizedTextarea
        name={name}
        className="min-h-24 w-full min-w-0 max-w-full rounded-xl border border-slate-300 p-3 text-sm font-normal outline-none focus:border-[#0875d1] sm:min-h-32 sm:p-4 sm:text-base"
        placeholder={placeholder}
        defaultValue={defaultValue}
        {...textareaProps}
      />
    </label>
  );
}

export function PhotoField({
  autoOpenCropper,
  defaultPhotos,
  label,
  description,
  maxPhotos,
  required = false,
}: {
  autoOpenCropper?: boolean;
  defaultPhotos?: string[];
  label: string;
  description: string;
  maxPhotos?: number;
  required?: boolean;
}) {
  return <FormPhotoUploader label={label} description={description} defaultPhotos={defaultPhotos} maxPhotos={maxPhotos} required={required} autoOpenCropper={autoOpenCropper} />;
}
