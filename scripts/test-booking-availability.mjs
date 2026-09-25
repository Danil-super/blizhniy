import assert from "node:assert/strict";
import test from "node:test";
import {
  addBookingDays,
  bookingNightsCount,
  bookingTodayKey,
  isStayPeriodUnavailable,
  parseBookingDate,
  remainingTourSeats,
} from "../src/lib/booking-availability.ts";

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
