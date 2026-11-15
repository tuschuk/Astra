/**
 * Tests for the Supabase-backed transport, against a recording fake of the
 * Supabase query builder (tests never touch the real project). They check
 * that each operation builds the request the sync engine relies on.
 */
import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import { CHILD_PAGE_ROWS, afterCursorFilter, createSupabaseTransport } from './supabaseTransport';

type Call = [string, ...unknown[]];

/**
 * A stand-in Supabase client. Every builder call is recorded; awaiting the
 * builder returns the next queued response.
 */
function recordingClient(responses: { data?: unknown[]; error?: { message: string } | null }[] = []) {
  const requests: Call[][] = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [['from', table]];
      requests.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'or', 'order', 'limit', 'in', 'range', 'upsert']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) => {
        const next = responses.shift() ?? { data: [], error: null };
        return Promise.resolve({ data: next.data ?? [], error: next.error ?? null }).then(resolve);
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, requests };
}

describe('afterCursorFilter', () => {
  it('means "later timestamp, or same timestamp and later id", with the timestamp quoted', () => {
    expect(afterCursorFilter({ updated_at: '2026-11-14T10:00:00.123+00:00', id: 'abc' })).toBe(
      'updated_at.gt."2026-11-14T10:00:00.123+00:00",and(updated_at.eq."2026-11-14T10:00:00.123+00:00",id.gt.abc)',
    );
  });
});

describe('createSupabaseTransport', () => {
  it('uploads as an upsert on id', async () => {
    const { client, requests } = recordingClient();
    await createSupabaseTransport(client).upsert('workouts', [{ id: 'w1' } as never]);
    expect(requests[0]).toEqual([
      ['from', 'workouts'],
      ['upsert', [{ id: 'w1' }], { onConflict: 'id' }],
    ]);
  });

  it('skips the request for an empty upload', async () => {
    const { client, requests } = recordingClient();
    await createSupabaseTransport(client).upsert('sets', []);
    expect(requests).toEqual([]);
  });

  it('throws when the server refuses an upload', async () => {
    const { client } = recordingClient([{ error: { message: 'new row violates row-level security policy' } }]);
    await expect(createSupabaseTransport(client).upsert('workouts', [{ id: 'w1' } as never])).rejects.toThrow(
      'Upload to workouts failed: new row violates row-level security policy',
    );
  });

  it("pulls the user's workouts after a bookmark, in (updated_at, id) order", async () => {
    const { client, requests } = recordingClient([{ data: [{ id: 'w1' }] }]);
    const rows = await createSupabaseTransport(client).pullWorkouts('u1', { updated_at: 't', id: 'i' }, 500);
    expect(rows).toEqual([{ id: 'w1' }]);
    expect(requests[0]).toEqual([
      ['from', 'workouts'],
      ['select', 'id,user_id,title,notes,started_at,ended_at,visibility,created_at,updated_at'],
      ['eq', 'user_id', 'u1'],
      ['or', afterCursorFilter({ updated_at: 't', id: 'i' })],
      ['order', 'updated_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['limit', 500],
    ]);
  });

  it('pulls exercises from the beginning with no user filter (RLS scopes them)', async () => {
    const { client, requests } = recordingClient();
    await createSupabaseTransport(client).pullExercises(null, 500);
    const methods = requests[0].map((c) => c[0]);
    expect(methods).not.toContain('eq');
    expect(methods).not.toContain('or');
  });

  it('pages child downloads so a server response cap can never cut rows off', async () => {
    const full = Array.from({ length: CHILD_PAGE_ROWS }, (_, i) => ({ id: `s${i}` }));
    const { client, requests } = recordingClient([{ data: full }, { data: [{ id: 'last' }] }]);
    const rows = await createSupabaseTransport(client).pullSets(['e1', 'e2']);
    expect(rows).toHaveLength(CHILD_PAGE_ROWS + 1);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContainEqual(['in', 'workout_exercise_id', ['e1', 'e2']]);
    expect(requests[1]).toContainEqual(['range', CHILD_PAGE_ROWS, 2 * CHILD_PAGE_ROWS - 1]);
  });

  it('pulls entries by workout id and throws on a download error', async () => {
    const { client, requests } = recordingClient([{ error: { message: 'timeout' } }]);
    await expect(createSupabaseTransport(client).pullWorkoutExercises(['w1'])).rejects.toThrow(
      'Download of workout_exercises failed: timeout',
    );
    expect(requests[0]).toContainEqual(['in', 'workout_id', ['w1']]);
    expect(await createSupabaseTransport(client).pullWorkoutExercises([])).toEqual([]);
  });
});
