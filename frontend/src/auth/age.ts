/**
 * Age gate — the 18+ rule at signup (NFR-8), as pure functions.
 *
 * Why this exists: Astra is 18+ only. The sign-up screen uses these to refuse
 * an under-18 (or nonsense) birthdate instantly, with a clear message, before
 * any network call. The database's signup trigger enforces the same rule
 * server-side (migration `signup_birthdate_gate`), so these functions are the
 * friendly front door — the trigger is the lock.
 *
 * Dates are plain calendar dates written as ISO strings ("2008-03-01"), never
 * JavaScript Date objects, so time zones and clock times can't shift a
 * birthday by a day.
 */

/** A calendar date as "YYYY-MM-DD". */
export type ISODate = string;

/** The minimum age to hold an Astra account. */
export const MINIMUM_AGE = 18;

/** The refusal shown when someone is under 18. */
export const UNDER_AGE_MESSAGE = 'Astra is 18+. You must be 18 or older to create an account.';

/** The refusal shown when the typed birthdate isn't a real (past) calendar date. */
const NOT_A_REAL_DATE = "That birthdate isn't a real date. Check the month, day and year.";

/** What the three birthdate boxes on the sign-up screen contain, as typed. */
export interface BirthdateFields {
  month: string;
  day: string;
  year: string;
}

/** The result of checking a typed birthdate: either a usable ISO date or a message to show. */
export type BirthdateCheck = { ok: true; birthdate: ISODate } | { ok: false; message: string };

/** Earliest birth year accepted — anything older is a typo, not a lifter. */
const EARLIEST_YEAR = 1900;

/** Is `year` a leap year in the Gregorian calendar? */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** How many days `month` (1–12) has in `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Writes a year/month/day as "YYYY-MM-DD" with zero padding. */
function toISO(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Splits an ISO date back into numbers. Assumes the input is well-formed. */
function parseISO(date: ISODate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

/**
 * Today's date on this device, as an ISO date in the device's local time zone.
 * The sign-up screen gates on the user's own calendar day.
 */
export function localToday(now: Date = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * The latest birthdate that is 18 or older on `today`: the same calendar day
 * 18 years earlier. If that day doesn't exist (today is Feb 29 and 18 years
 * ago wasn't a leap year) it falls back to the month's last day.
 *
 * This deliberately matches Postgres' `current_date - interval '18 years'`,
 * which the server trigger uses, so the app and the database agree on every
 * boundary — including Feb 29 birthdays, who turn 18 on Mar 1 in non-leap
 * years.
 */
export function latestAllowedBirthdate(today: ISODate): ISODate {
  const { year, month, day } = parseISO(today);
  const targetYear = year - MINIMUM_AGE;
  return toISO(targetYear, month, Math.min(day, daysInMonth(targetYear, month)));
}

/**
 * True when someone born on `birthdate` is at least 18 on `today`.
 * Both inputs are ISO dates; ISO strings of equal length compare correctly
 * as plain text, which is why no Date math is needed.
 */
export function isAtLeast18(birthdate: ISODate, today: ISODate): boolean {
  return birthdate <= latestAllowedBirthdate(today);
}

/**
 * Turns the three typed birthdate boxes into a checked ISO date.
 *
 * Inputs: the raw text of the month, day and year boxes, plus today's date
 * (injectable so tests can pin every boundary).
 * Output: `{ ok: true, birthdate }` when it's a real date and the person is
 * 18+, otherwise `{ ok: false, message }` with copy ready to show on screen.
 */
export function checkBirthdate(fields: BirthdateFields, today: ISODate): BirthdateCheck {
  const digitsOnly = /^\d+$/;
  const month = fields.month.trim();
  const day = fields.day.trim();
  const year = fields.year.trim();

  if (!month || !day || !year) {
    return { ok: false, message: 'Enter your full birthdate.' };
  }
  if (!digitsOnly.test(month) || !digitsOnly.test(day) || !digitsOnly.test(year) || year.length !== 4) {
    return { ok: false, message: 'Enter your birthdate as numbers: month, day and a four-digit year.' };
  }

  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  const todayYear = parseISO(today).year;
  if (m < 1 || m > 12 || y < EARLIEST_YEAR || y > todayYear || d < 1 || d > daysInMonth(y, m)) {
    return { ok: false, message: NOT_A_REAL_DATE };
  }

  const birthdate = toISO(y, m, d);
  if (birthdate > today) {
    return { ok: false, message: NOT_A_REAL_DATE };
  }
  if (!isAtLeast18(birthdate, today)) {
    return { ok: false, message: UNDER_AGE_MESSAGE };
  }
  return { ok: true, birthdate };
}
