"use client";

import { useEffect, useRef } from "react";

type EmployerType = "organization" | "ip" | "person";

const innWeights10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const innWeights11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const innWeights12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

function checksumDigit(value: string, weights: number[]) {
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  return (sum % 11) % 10;
}

function isValidInn(value: string, employerType: EmployerType) {
  if (employerType === "organization") {
    return value.length === 10 && checksumDigit(value, innWeights10) === Number(value[9]);
  }

  if (employerType === "ip") {
    return value.length === 12 && checksumDigit(value, innWeights11) === Number(value[10]) && checksumDigit(value, innWeights12) === Number(value[11]);
  }

  return true;
}

function isValidOgrn(value: string) {
  return value.length === 13 && Number((BigInt(value.slice(0, 12)) % BigInt(11)) % BigInt(10)) === Number(value[12]);
}

function isValidOgrnip(value: string) {
  return value.length === 15 && Number((BigInt(value.slice(0, 14)) % BigInt(13)) % BigInt(10)) === Number(value[14]);
}

function digitsOnly(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function getInput(form: HTMLFormElement, name: string) {
  const element = form.elements.namedItem(name);
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
}

function getEmployerType(form: HTMLFormElement): EmployerType {
  const value = getInput(form, "employerType")?.value;

  return value === "ip" || value === "person" ? value : "organization";
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

      if (inn instanceof HTMLInputElement) {
        inn.value = digitsOnly(inn.value, employerType === "ip" ? 12 : 10);
        const expectedLength = employerType === "ip" ? 12 : 10;
        const expectedLabel = employerType === "ip" ? "12 цифр" : "10 цифр";
        const message =
          inn.value && inn.value.length !== expectedLength
            ? `ИНН должен содержать ${expectedLabel}.`
            : inn.value && !isValidInn(inn.value, employerType)
              ? "Проверьте ИНН: контрольное число не совпадает."
              : "";
        setValidity(inn, message);
      }

      if (ogrn instanceof HTMLInputElement) {
        ogrn.value = digitsOnly(ogrn.value, 13);
        setValidity(ogrn, ogrn.value && (ogrn.value.length !== 13 || !isValidOgrn(ogrn.value)) ? "Проверьте ОГРН: должно быть 13 цифр с верным контрольным числом." : "");
      }

      if (ogrnip instanceof HTMLInputElement) {
        ogrnip.value = digitsOnly(ogrnip.value, 15);
        setValidity(ogrnip, ogrnip.value && (ogrnip.value.length !== 15 || !isValidOgrnip(ogrnip.value)) ? "Проверьте ОГРНИП: должно быть 15 цифр с верным контрольным числом." : "");
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
