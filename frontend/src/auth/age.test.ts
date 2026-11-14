/**
 * Tests for the 18+ age gate — every boundary the sign-up screen relies on,
 * including the leap-day cases that must agree with the server trigger.
 */
import { describe, expect, it } from '@jest/globals';

import {
  UNDER_AGE_MESSAGE,
  checkBirthdate,
  daysInMonth,
  isAtLeast18,
  latestAllowedBirthdate,
  localToday,
} from './age';

describe('isAtLeast18', () => {
  it('passes on the 18th birthday itself', () => {
    expect(isAtLeast18('2008-11-14', '2026-11-14')).toBe(true);
  });

  it('fails the day before the 18th birthday', () => {
    expect(isAtLeast18('2008-11-15', '2026-11-14')).toBe(false);
  });

  it('passes for anyone clearly older', () => {
    expect(isAtLeast18('1990-01-01', '2026-11-14')).toBe(true);
  });

  it('treats a Feb 29 birthday as turning 18 on Mar 1 in a non-leap year (matches Postgres)', () => {
    expect(isAtLeast18('2008-02-29', '2026-02-28')).toBe(false);
    expect(isAtLeast18('2008-02-29', '2026-03-01')).toBe(true);
  });

  it('on a leap day, someone born Feb 28 eighteen years earlier is 18 (cutoff clamps to Feb 28)', () => {
    // 2036-02-29 minus 18 years has no Feb 29 (2018 is not a leap year) → cutoff 2018-02-28.
    expect(isAtLeast18('2018-02-28', '2036-02-29')).toBe(true);
    expect(isAtLeast18('2018-03-01', '2036-02-29')).toBe(false);
  });

  it('a Feb 29 birthday is still 17 on Feb 28 of its 18th year', () => {
    expect(isAtLeast18('2012-02-29', '2030-02-28')).toBe(false);
  });
});

describe('latestAllowedBirthdate', () => {
  it('is the same calendar day 18 years earlier', () => {
    expect(latestAllowedBirthdate('2026-11-14')).toBe('2008-11-14');
  });

  it('clamps today=Feb 29 to Feb 28 when 18 years ago was not a leap year', () => {
    expect(latestAllowedBirthdate('2028-02-29')).toBe('2010-02-28');
  });
});

describe('daysInMonth', () => {
  it('knows leap-year February, including the century rules', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('localToday', () => {
  it('formats the device-local calendar date with zero padding', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('checkBirthdate', () => {
  const today = '2026-11-14';

  it('accepts an 18+ birthdate and returns it as an ISO date', () => {
    expect(checkBirthdate({ month: '3', day: '7', year: '1995' }, today)).toEqual({
      ok: true,
      birthdate: '1995-03-07',
    });
  });

  it('refuses an under-18 birthdate with the clear 18+ message', () => {
    expect(checkBirthdate({ month: '11', day: '15', year: '2008' }, today)).toEqual({
      ok: false,
      message: UNDER_AGE_MESSAGE,
    });
  });

  it('accepts someone whose 18th birthday is today', () => {
    expect(checkBirthdate({ month: '11', day: '14', year: '2008' }, today).ok).toBe(true);
  });

  it('asks for the full date when a box is empty', () => {
    const result = checkBirthdate({ month: '', day: '1', year: '1990' }, today);
    expect(result).toEqual({ ok: false, message: 'Enter your full birthdate.' });
  });

  it.each([
    ['letters', { month: 'ab', day: '1', year: '1990' }],
    ['a two-digit year', { month: '1', day: '1', year: '90' }],
    ['a negative number', { month: '-1', day: '1', year: '1990' }],
  ])('rejects non-numeric input: %s', (_label, fields) => {
    const result = checkBirthdate(fields, today);
    expect(result.ok).toBe(false);
  });

  it.each([
    ['month 13', { month: '13', day: '1', year: '1990' }],
    ['day 0', { month: '1', day: '0', year: '1990' }],
    ['Feb 30', { month: '2', day: '30', year: '1990' }],
    ['Feb 29 in a non-leap year', { month: '2', day: '29', year: '1990' }],
    ['a year before 1900', { month: '1', day: '1', year: '1899' }],
    ['a future year', { month: '1', day: '1', year: '2027' }],
    ['later this year', { month: '12', day: '1', year: '2026' }],
  ])('rejects impossible dates: %s', (_label, fields) => {
    const result = checkBirthdate(fields, today);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toBe(UNDER_AGE_MESSAGE);
  });

  it('accepts Feb 29 in a leap year', () => {
    expect(checkBirthdate({ month: '02', day: '29', year: '2000' }, today)).toEqual({
      ok: true,
      birthdate: '2000-02-29',
    });
  });

  it('ignores surrounding whitespace', () => {
    expect(checkBirthdate({ month: ' 1 ', day: ' 2 ', year: ' 1990 ' }, today).ok).toBe(true);
  });
});
