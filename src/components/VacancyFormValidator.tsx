"use client";

import { useEffect, useRef } from "react";

type EmployerType = "organization" | "ip" | "person";

function digitsOnly(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function salaryAmount(value: string) {
  const digits = value.replace(/\D/g, "");
  const amount = Number(digits);

  return Number.isFinite(amount) ? amount : 0;
}

function getInput(form: HTMLFormElement, name: string) {
  const element = form.elements.namedItem(name);
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
}

function getEmployerType(form: HTMLFormElement): EmployerType {
  const value = getInput(form, "employerType")?.value;

  if (value === "ip") {
    return "ip";
  }

  if (value === "person" || value === "private") {
    return "person";
  }

  return "organization";
}

function setValidity(input: HTMLInputElement | HTMLTextAreaElement | null, message = "") {
  input?.setCustomValidity(message);
}

export function VacancyFormValidator() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = ref.current?.closest("form");

    if (!(form instanceof HTMLFormElement)) {
      return undefined;
    }

    const formElement = form;

    function validateAll() {
      const employerType = getEmployerType(formElement);
      const inn = getInput(formElement, "inn");
      const ogrn = getInput(formElement, "ogrn");
      const ogrnip = getInput(formElement, "ogrnip");
      const salary = getInput(formElement, "salary");

      if (inn instanceof HTMLInputElement) {
        inn.value = digitsOnly(inn.value, 12);
        const expectedLength = employerType === "ip" ? 12 : 10;
        const expectedLabel = employerType === "ip" ? "12 цифр" : "10 цифр";
        const message =
          employerType !== "person" && inn.value && inn.value.length !== expectedLength
            ? `ИНН должен содержать ${expectedLabel}.`
            : "";
        setValidity(inn, message);
      }

      if (ogrn instanceof HTMLInputElement) {
        ogrn.value = digitsOnly(ogrn.value, 13);
        setValidity(ogrn, ogrn.value && ogrn.value.length !== 13 ? "ОГРН должен содержать 13 цифр." : "");
      }

      if (ogrnip instanceof HTMLInputElement) {
        ogrnip.value = digitsOnly(ogrnip.value, 15);
        setValidity(ogrnip, ogrnip.value && ogrnip.value.length !== 15 ? "ОГРНИП должен содержать 15 цифр." : "");
      }

      if (salary instanceof HTMLInputElement) {
        setValidity(salary, salary.value && salaryAmount(salary.value) <= 0 ? "Укажите оплату цифрами, например 80000." : "");
      }
    }

    const handleValidate = () => validateAll();

    validateAll();
    formElement.addEventListener("input", handleValidate, true);
    formElement.addEventListener("change", handleValidate, true);
    formElement.addEventListener("click", handleValidate, true);

    return () => {
      formElement.removeEventListener("input", handleValidate, true);
      formElement.removeEventListener("change", handleValidate, true);
      formElement.removeEventListener("click", handleValidate, true);
    };
  }, []);

  return <span ref={ref} className="hidden" aria-hidden="true" />;
}
