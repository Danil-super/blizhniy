import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Compile the same TS module imported by payment-provider without loading Next.js.
const source = await readFile(new URL("../src/lib/yookassa-payment-validation.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { yookassaStatusToPaymentStatus, verifyYooKassaPayment } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const payment = {
  id: "local-payment-id",
  providerPaymentId: "provider-payment-id",
  amount: 100,
  tariffId: "listing-publication",
  targetId: "listing-id",
  targetType: "listing",
};
const providerPayment = {
  id: payment.providerPaymentId,
  status: "succeeded",
  paid: true,
  amount: { value: "100.00", currency: "RUB" },
  metadata: {
    localPaymentId: payment.id,
    tariffId: payment.tariffId,
    targetId: payment.targetId,
    targetType: payment.targetType,
  },
};

test("only the final captured YooKassa status grants an entitlement", () => {
  assert.equal(yookassaStatusToPaymentStatus("pending", false), "pending");
  assert.equal(yookassaStatusToPaymentStatus("pending", true), "pending");
  assert.equal(yookassaStatusToPaymentStatus("waiting_for_capture", true), "pending");
  assert.equal(yookassaStatusToPaymentStatus("succeeded", true), "succeeded");
  assert.equal(yookassaStatusToPaymentStatus("canceled", false), "failed");
  assert.throws(() => yookassaStatusToPaymentStatus("succeeded", false));
  assert.throws(() => yookassaStatusToPaymentStatus("canceled", true));
  assert.throws(() => yookassaStatusToPaymentStatus("succeeded"));
  assert.throws(() => yookassaStatusToPaymentStatus("unexpected", true));
});

test("the provider must echo the exact payment, amount, currency and all metadata", () => {
  assert.doesNotThrow(() => verifyYooKassaPayment(payment, providerPayment));
  const invalids = [
    { ...providerPayment, id: "another-payment-id" },
    { ...providerPayment, amount: { value: "100.01", currency: "RUB" } },
    { ...providerPayment, amount: { value: "100.00", currency: "USD" } },
    { ...providerPayment, metadata: undefined },
    ...Object.keys(providerPayment.metadata).flatMap((key) => [
      { ...providerPayment, metadata: { ...providerPayment.metadata, [key]: undefined } },
      { ...providerPayment, metadata: { ...providerPayment.metadata, [key]: "another-target" } },
    ]),
  ];

  for (const invalid of invalids) {
    assert.throws(() => verifyYooKassaPayment(payment, invalid));
  }
});
