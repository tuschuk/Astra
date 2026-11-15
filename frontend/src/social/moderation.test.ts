/**
 * Tests for the safety controls (B27, SOC-8): a report lands as one row with the reason and
 * trimmed details, a second report of the same thing is still "thanks", a failure is one calm
 * sentence; mute / block add and remove exactly the actor's row (twice is harmless); the profile's
 * relation read; and the report reasons pinned against the server's CHECK list. The server's
 * row-level security (what disappears) is probed live, not here.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';

import {
  blockUser,
  cleanDetails,
  detailsTooLong,
  muteUser,
  relationTo,
  report,
  reportComment,
  reportPost,
  REPORT_DETAILS_MAX_CHARS,
  REPORT_FAILED,
  REPORT_REASONS,
  REPORT_TOO_LONG,
  SAFETY_FAILED,
  unblockUser,
  unmuteUser,
} from './moderation';

const ME = 'me';
const PAT = 'pat';

describe('REPORT_REASONS', () => {
  it('matches the reports.reason CHECK in the moderation migration, in order', () => {
    // Spelled out here as the migration spells it — the mirror pair (see the migration comment).
    expect(REPORT_REASONS.map((r) => r.value)).toEqual(['spam', 'harassment', 'nudity', 'not-training', 'impersonation', 'other']);
  });
});

describe('details', () => {
  it('trims, and sends nothing for blank', () => {
    expect(cleanDetails('  rude  ')).toBe('rude');
    expect(cleanDetails('   ')).toBeNull();
  });

  it('counts characters the way the server does (an emoji is one)', () => {
    expect(detailsTooLong('a'.repeat(REPORT_DETAILS_MAX_CHARS))).toBe(false);
    expect(detailsTooLong('a'.repeat(REPORT_DETAILS_MAX_CHARS + 1))).toBe(true);
    expect(detailsTooLong('💪'.repeat(REPORT_DETAILS_MAX_CHARS))).toBe(false);
  });
});

describe('report', () => {
  it('files one row with the reason and trimmed details — never the reported person', async () => {
    const fake = createFakeSocialClient();
    const result = await report(fake.client, ME, { kind: 'post', id: 'p1' }, 'spam', '  ads in every post ');
    expect(result).toEqual({ ok: true });
    expect(fake.tables.reports).toEqual([
      { reporter_id: ME, target_kind: 'post', target_id: 'p1', reason: 'spam', details: 'ads in every post' },
    ]);
  });

  it('a comment report with no details sends null details', async () => {
    const fake = createFakeSocialClient();
    await report(fake.client, ME, { kind: 'comment', id: 'c1' }, 'harassment', '');
    expect(fake.tables.reports[0]).toMatchObject({ target_kind: 'comment', target_id: 'c1', details: null });
  });

  it('reporting the same thing twice is still a success, and still one row', async () => {
    const fake = createFakeSocialClient();
    await report(fake.client, ME, { kind: 'post', id: 'p1' }, 'spam', '');
    expect(await report(fake.client, ME, { kind: 'post', id: 'p1' }, 'other', '')).toEqual({ ok: true });
    expect(fake.tables.reports).toHaveLength(1);
  });

  it('offline: one calm sentence, nothing filed', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    expect(await report(fake.client, ME, { kind: 'post', id: 'p1' }, 'spam', '')).toEqual({ ok: false, message: REPORT_FAILED });
  });

  it('too-long details are refused before anything is sent', async () => {
    const fake = createFakeSocialClient();
    const result = await report(fake.client, ME, { kind: 'post', id: 'p1' }, 'spam', 'a'.repeat(REPORT_DETAILS_MAX_CHARS + 1));
    expect(result).toEqual({ ok: false, message: REPORT_TOO_LONG });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('reportPost / reportComment', () => {
  it('file the right kind of report', async () => {
    const fake = createFakeSocialClient();
    await reportPost(fake.client, ME, 'p1', 'spam', '');
    await reportComment(fake.client, ME, 'c1', 'nudity', '');
    expect(fake.tables.reports.map((r) => [r.target_kind, r.target_id, r.reason])).toEqual([
      ['post', 'p1', 'spam'],
      ['comment', 'c1', 'nudity'],
    ]);
  });

  it('send nothing without a session', async () => {
    const fake = createFakeSocialClient();
    expect(await reportPost(fake.client, null, 'p1', 'spam', '')).toEqual({ ok: false, message: REPORT_FAILED });
    expect(await reportComment(fake.client, null, 'c1', 'spam', '')).toEqual({ ok: false, message: REPORT_FAILED });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('mute and block', () => {
  it('mute adds the actor’s row; twice is harmless; unmute removes only that row', async () => {
    const fake = createFakeSocialClient({ mutes: [{ muter_id: 'someone', muted_id: PAT }] });
    expect(await muteUser(fake.client, ME, PAT)).toEqual({ ok: true });
    expect(await muteUser(fake.client, ME, PAT)).toEqual({ ok: true });
    expect(fake.tables.mutes).toEqual([
      { muter_id: 'someone', muted_id: PAT },
      { muter_id: ME, muted_id: PAT },
    ]);
    expect(await unmuteUser(fake.client, ME, PAT)).toEqual({ ok: true });
    expect(fake.tables.mutes).toEqual([{ muter_id: 'someone', muted_id: PAT }]);
  });

  it('block adds the actor’s row; unblock removes it', async () => {
    const fake = createFakeSocialClient();
    expect(await blockUser(fake.client, ME, PAT)).toEqual({ ok: true });
    expect(await blockUser(fake.client, ME, PAT)).toEqual({ ok: true });
    expect(fake.tables.blocks).toEqual([{ blocker_id: ME, blocked_id: PAT }]);
    expect(await unblockUser(fake.client, ME, PAT)).toEqual({ ok: true });
    expect(fake.tables.blocks).toEqual([]);
  });

  it('offline: the calm sentence', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    expect(await muteUser(fake.client, ME, PAT)).toEqual({ ok: false, message: SAFETY_FAILED });
    expect(await unblockUser(fake.client, ME, PAT)).toEqual({ ok: false, message: SAFETY_FAILED });
  });
});

describe('relationTo', () => {
  it('reads whether I block and/or mute this lifter — nobody else’s rows count', async () => {
    const fake = createFakeSocialClient({
      blocks: [{ blocker_id: PAT, blocked_id: ME }],
      mutes: [{ muter_id: ME, muted_id: PAT }],
    });
    expect(await relationTo(fake.client, ME, PAT)).toEqual({ blocking: false, muting: true });
    await blockUser(fake.client, ME, PAT);
    expect(await relationTo(fake.client, ME, PAT)).toEqual({ blocking: true, muting: true });
  });

  it('throws offline, like the profile’s other loaders', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(relationTo(fake.client, ME, PAT)).rejects.toThrow('Reading blocks failed');
  });
});
