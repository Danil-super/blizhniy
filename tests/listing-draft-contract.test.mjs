import assert from "node:assert/strict";
import { test } from "node:test";
import { parseListingDraft, parseListingDraftId, parseListingDraftRevision, ListingDraftInputError } from "../src/lib/listing-draft-contract.ts";

test("draft contract supports partial drafts without inventing category, city or price", () => {
  assert.deepEqual(parseListingDraft({ kind: "prodam" }), {
    kind: "prodam", title: "", description: "", categoryId: null, cityId: null, price: null,
  });
  for (const kind of ["prodam", "kuplyu", "otdam-darom", "arenda"]) assert.equal(parseListingDraft({ kind }).kind, kind);
});

test("draft IDs are canonical UUIDs, never arbitrary SQL fragments", () => {
  assert.equal(parseListingDraftId("ABCD1234-ABCD-1234-ABCD-ABCD1234ABCD"), "abcd1234-abcd-1234-abcd-abcd1234abcd");
  for (const value of [null, undefined, 1, "", "abc", "x' OR true --"]) assert.throws(() => parseListingDraftId(value), ListingDraftInputError);
  const id = "abcd1234-abcd-1234-abcd-abcd1234abcd";
  assert.deepEqual(parseListingDraft({ kind: "prodam", categoryId: id.toUpperCase(), cityId: id }), {
    kind: "prodam", title: "", description: "", categoryId: id, cityId: id, price: null,
  });
});

test("price is an exact decimal string, including zero and the numeric(12,2) maximum", () => {
  for (const [input, expected] of [["0", "0.00"], ["0.1", "0.10"], ["12.34", "12.34"], ["9999999999.99", "9999999999.99"]]) {
    assert.equal(parseListingDraft({ kind: "prodam", price: input }).price, expected);
  }
  for (const value of [0, NaN, Infinity, "", "00", "-1", "1e2", "1,23", "0.001", "10000000000", "NaN", " 1 "]) {
    assert.throws(() => parseListingDraft({ kind: "prodam", price: value }), ListingDraftInputError);
  }
});

test("revision remains a canonical bigint string above JavaScript precision", () => {
  for (const revision of ["1", "9007199254740993", "9223372036854775807"]) assert.equal(parseListingDraftRevision(revision), revision);
  for (const revision of [1, 9007199254740993n, null, undefined, "0", "01", "1.0", "1e2", "-1", "9223372036854775808"]) {
    assert.throws(() => parseListingDraftRevision(revision), ListingDraftInputError);
  }
});

test("text is bounded and well formed; description retains multiline input", () => {
  assert.equal(parseListingDraft({ kind: "prodam", title: "  Название  ", description: "a\n\tb\r\nc" }).title, "Название");
  assert.equal(parseListingDraft({ kind: "prodam", description: "a\n\tb\r\nc" }).description, "a\n\tb\r\nc");
  assert.equal(parseListingDraft({ kind: "prodam", title: "t".repeat(160), description: "d".repeat(10000) }).title.length, 160);
  for (const bad of [{ title: "t".repeat(161) }, { description: "d".repeat(10001) }, { title: "a\nb" },
    { title: "\u0000" }, { description: "\u0000" }, { title: "\ud800" }, { description: "\udc00" }, { title: 7 }, { title: null }]) {
    assert.throws(() => parseListingDraft({ kind: "prodam", ...bad }), ListingDraftInputError);
  }
});

test("only editable core fields are accepted; identity, payment, status and media claims are rejected", () => {
  for (const field of ["authorId", "author_id", "ownerKey", "status", "is_paid", "paid", "revision", "id", "publishedAt", "expiresAt",
    "images", "mediaPaths", "booking", "phone", "address", "messengerUrl", "role"]) {
    assert.throws(() => parseListingDraft({ kind: "prodam", [field]: "forged" }), ListingDraftInputError);
  }
  for (const value of [null, [], "draft", {}, { kind: "vacancy" }, { kind: "prodam", categoryId: "bad" },
    { kind: "prodam", cityId: 12 }, new Date()]) assert.throws(() => parseListingDraft(value), ListingDraftInputError);
  assert.throws(() => parseListingDraft(JSON.parse('{"kind":"prodam","__proto__":{}}')), ListingDraftInputError);
  assert.throws(() => parseListingDraft(Object.create({ kind: "prodam" })), ListingDraftInputError);
});
