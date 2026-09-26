import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Transpile the real implementation so the tests also run on supported Node 20.
const source = await readFile(new URL("../src/lib/booking-availability.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  addBookingDays,
  bookingAvailabilityPath,
  bookingNightsCount,
  bookingTodayKey,
  isStayPeriodUnavailable,
  parseBookingDate,
  remainingTourSeats,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const listingId = "11111111-1111-4111-8111-111111111111";
const request = (startDate, endDate, guests, status) => ({ listingId, startDate, endDate, guests, status });

test("invalid calendar dates do not turn into a different valid date", () => {
  assert.equal(parseBookingDate("2026-02-30"), undefined);
  assert.equal(parseBookingDate("2026-13-01"), undefined);
  assert.equal(parseBookingDate("2026-02-28T00:00"), undefined);
  assert.equal(bookingNightsCount("2026-02-30", "2026-03-03"), undefined);
  assert.equal(bookingNightsCount("2026-12-31", "2027-01-03"), 3);
  assert.equal(addBookingDays("2026-12-31", 1), "2027-01-01");
});

test("booking day follows the Moscow calendar at the UTC boundary", () => {
  assert.equal(bookingTodayKey(new Date("2026-09-25T21:10:00Z")), "2026-09-26");
});

test("a pending tour request does not reserve every remaining seat", () => {
  const requests = [request("2026-10-10", undefined, 5, "pending"), request("2026-10-10", undefined, 3, "accepted")];
  assert.equal(remainingTourSeats(10, "2026-10-10", requests, listingId), 7);
  requests.push(request("2026-10-10", undefined, 6, "accepted"));
  assert.equal(remainingTourSeats(10, "2026-10-10", requests, listingId), 1);
  assert.equal(remainingTourSeats(10, "2026-10-11", requests, listingId), 10);
});

test("stay reservations overlap by occupied nights, leaving checkout free", () => {
  const requests = [request("2026-10-10", "2026-10-12", 2, "accepted"), request("2026-10-13", "2026-10-14", 2, "declined")];
  assert.equal(isStayPeriodUnavailable("2026-10-11", "2026-10-13", requests, listingId), true);
  assert.equal(isStayPeriodUnavailable("2026-10-12", "2026-10-13", requests, listingId), false);
  assert.equal(isStayPeriodUnavailable("2026-10-13", "2026-10-14", requests, listingId), false);
});

test("public availability includes a stay that started before today and ends tomorrow", () => {
  const path = bookingAvailabilityPath(listingId, "2026-10-11");
  assert.match(path, /&or=\(start_date\.gte\.2026-10-11,end_date\.gt\.2026-10-11\)/);
  assert.equal(isStayPeriodUnavailable("2026-10-11", "2026-10-12", [request("2026-10-10", "2026-10-12", 2, "accepted")], listingId), true);
  assert.equal(isStayPeriodUnavailable("2026-10-12", "2026-10-13", [request("2026-10-10", "2026-10-12", 2, "accepted")], listingId), false);
});
