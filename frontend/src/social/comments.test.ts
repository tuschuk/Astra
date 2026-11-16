/**
 * Tests for reading and writing comments (B23, SOC-5): the request built, conversation order,
 * the "more exist" flag at the cap, shaping, and adding one — refused up front when the text
 * breaks the rules, otherwise returned as the server saved it. (B41) The program arm reads and
 * writes `program_comments` by `program_id` with the same order, cap and text rules.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import { COMMENT_EMPTY, COMMENT_MAX_CHARS, COMMENT_TOO_LONG } from './commentLimits';
import {
  addComment,
  addProgramComment,
  COMMENT_SELECT,
  COMMENTS_LIMIT,
  loadComments,
  loadProgramComments,
  PROGRAM_COMMENT_SELECT,
  toPostComment,
} from './comments';

const ann = profile('ann', 'ann_lifts', 'Ann');
const bob = profile('bob', 'bob_lifts', null);

/** A stored comment row. */
function comment(id: string, user: string, createdAt: string, body = `Comment ${id}`, postId = 'p1') {
  return { id, post_id: postId, user_id: user, body, created_at: createdAt };
}

describe('loadComments', () => {
  it('asks for one post’s comments with the author, oldest first, id as the tiebreak', async () => {
    const fake = createFakeSocialClient({
      profiles: [ann, bob],
      comments: [
        comment('c3', 'ann', '2026-11-15T10:00:00.000Z'),
        comment('c1', 'bob', '2026-11-15T09:00:00.000Z'),
        comment('c2', 'ann', '2026-11-15T09:00:00.000Z'),
        comment('other', 'ann', '2026-11-15T08:00:00.000Z', 'elsewhere', 'p2'),
      ],
    });
    const page = await loadComments(fake.client, 'p1');
    expect(page.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(page.comments[0].author).toEqual({ id: 'bob', username: 'bob_lifts', displayName: null });
    expect(page.more).toBe(false);
    expect(fake.requests[0]).toEqual([
      ['from', 'comments'],
      ['select', COMMENT_SELECT],
      ['eq', 'post_id', 'p1'],
      ['order', 'created_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['limit', COMMENTS_LIMIT],
    ]);
  });

  it('says more exist when a full load arrives', async () => {
    const many = Array.from({ length: COMMENTS_LIMIT + 3 }, (_, i) =>
      comment(`c${String(i).padStart(3, '0')}`, 'ann', '2026-11-15T09:00:00.000Z'),
    );
    const fake = createFakeSocialClient({ profiles: [ann], comments: many });
    const page = await loadComments(fake.client, 'p1');
    expect(page.comments).toHaveLength(COMMENTS_LIMIT);
    expect(page.more).toBe(true);
  });

  it('throws when the request fails (no connection)', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(loadComments(fake.client, 'p1')).rejects.toThrow('Loading the comments failed');
  });
});

describe('toPostComment', () => {
  it('fills in a missing author from the row’s user id instead of crashing', () => {
    expect(toPostComment({ ...comment('c', 'ghost', '2026-11-15T09:00:00.000Z'), author: null }).author).toEqual({
      id: 'ghost',
      username: null,
      displayName: null,
    });
  });
});

describe('addComment', () => {
  it('inserts as me and returns the saved row, author and all', async () => {
    const fake = createFakeSocialClient({ profiles: [ann] });
    const saved = await addComment(fake.client, 'ann', 'p1', 'Huge PR!');
    expect(saved).toMatchObject({ body: 'Huge PR!', author: { id: 'ann', username: 'ann_lifts', displayName: 'Ann' } });
    expect(saved.id).toBeTruthy();
    expect(fake.tables.comments).toEqual([expect.objectContaining({ post_id: 'p1', user_id: 'ann', body: 'Huge PR!' })]);
    expect(fake.requests[0]).toEqual([
      ['from', 'comments'],
      ['insert', { post_id: 'p1', user_id: 'ann', body: 'Huge PR!' }],
      ['select', COMMENT_SELECT],
      ['single'],
    ]);
  });

  it('refuses blank or over-long text without sending anything', async () => {
    const fake = createFakeSocialClient();
    await expect(addComment(fake.client, 'ann', 'p1', '   ')).rejects.toThrow(COMMENT_EMPTY);
    await expect(addComment(fake.client, 'ann', 'p1', 'x'.repeat(COMMENT_MAX_CHARS + 1))).rejects.toThrow(COMMENT_TOO_LONG);
    expect(fake.requests).toHaveLength(0);
  });

  it('throws when the request fails', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(addComment(fake.client, 'ann', 'p1', 'hi')).rejects.toThrow('Posting the comment failed');
  });
});

describe('program comments (B41 — MKT-3)', () => {
  /** A stored program comment row. */
  function programComment(id: string, user: string, createdAt: string, programId = 'prog') {
    return { id, program_id: programId, user_id: user, body: `Comment ${id}`, created_at: createdAt };
  }

  it('loads one program’s comments from program_comments, oldest first, with authors — same cap and flag', async () => {
    const fake = createFakeSocialClient({
      profiles: [ann, bob],
      program_comments: [
        programComment('c2', 'ann', '2026-11-15T10:00:00.000Z'),
        programComment('c1', 'bob', '2026-11-15T09:00:00.000Z'),
        programComment('other', 'ann', '2026-11-15T08:00:00.000Z', 'elsewhere'),
      ],
      // A post comment with the same id space never leaks in.
      comments: [comment('c9', 'ann', '2026-11-15T07:00:00.000Z', 'post comment', 'prog')],
    });
    const page = await loadProgramComments(fake.client, 'prog');
    expect(page.comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(page.comments[0].author).toEqual({ id: 'bob', username: 'bob_lifts', displayName: null });
    expect(page.more).toBe(false);
    const calls = fake.requests[0];
    expect(calls[0]).toEqual(['from', 'program_comments']);
    expect(calls).toContainEqual(['select', PROGRAM_COMMENT_SELECT]);
    expect(calls).toContainEqual(['eq', 'program_id', 'prog']);
    expect(calls).toContainEqual(['limit', COMMENTS_LIMIT]);
  });

  it('adds one as me and returns the saved row; the same text rules refuse up front', async () => {
    const fake = createFakeSocialClient({ profiles: [ann] });
    const saved = await addProgramComment(fake.client, 'ann', 'prog', 'Ran it twice, great block');
    expect(saved).toMatchObject({ body: 'Ran it twice, great block', author: { id: 'ann', displayName: 'Ann' } });
    expect(fake.tables.program_comments).toHaveLength(1);
    expect(fake.tables.program_comments[0]).toMatchObject({ program_id: 'prog', user_id: 'ann' });
    await expect(addProgramComment(fake.client, 'ann', 'prog', '   ')).rejects.toThrow(COMMENT_EMPTY);
    await expect(addProgramComment(fake.client, 'ann', 'prog', 'x'.repeat(COMMENT_MAX_CHARS + 1))).rejects.toThrow(COMMENT_TOO_LONG);
    expect(fake.tables.program_comments).toHaveLength(1);
  });

  it('throws when the request fails', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(loadProgramComments(fake.client, 'prog')).rejects.toThrow('Loading the comments failed');
    await expect(addProgramComment(fake.client, 'ann', 'prog', 'hi')).rejects.toThrow('Posting the comment failed');
  });
});
