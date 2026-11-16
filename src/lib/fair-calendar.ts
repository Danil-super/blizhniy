import {bookingTodayKey} from './booking-availability.ts';

/** Last Sunday of the month, including the whole event day in Moscow. */
export function nextFairEvent(now = new Date()) {
  const today = new Date(bookingTodayKey(now) + 'T00:00:00Z');
  const lastSunday = (year: number, month: number) => {
    const date = new Date(Date.UTC(year, month + 1, 0));
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return date;
  };
  const current = lastSunday(today.getUTCFullYear(), today.getUTCMonth());
  const event = today <= current ? current : lastSunday(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const date = event.toISOString().slice(0, 10);
  return {date, endsAt: new Date(Date.parse(date + 'T00:00:00+03:00') + 86400000).toISOString()};
}
