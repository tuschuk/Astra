/**
 * Tests for the Supabase-backed transport, against a recording fake of the
 * Supabase query builder (tests never touch the real project). They check
 * that each operation builds the request the sync engine relies on.
 */
import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import { CHILD_PAGE_ROWS, afterCursorFilter, createSupabaseTransport, toAnalysisRow } from './supabaseTransport';
import { PostAlreadyExistsError } from './transport';

type Call = [string, ...unknown[]];

/**
 * A stand-in Supabase client. Every builder call is recorded; awaiting the
 * builder returns the next queued response.
 */
function recordingClient(responses: { data?: unknown; error?: { message: string; code?: string } | null }[] = []) {
  const requests: Call[][] = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [['from', table]];
      requests.push(calls);
      const builder: Record<string, unknown> = {};
      const methods = ['select', 'eq', 'gt', 'or', 'order', 'limit', 'in', 'range', 'upsert', 'delete', 'update', 'maybeSingle'];
      for (const method of methods) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) => {
        const next = responses.shift() ?? { data: [], error: null };
        // `data: null` is passed through (a maybeSingle() that found nothing); absent means [].
        const data = 'data' in next ? next.data : [];
        return Promise.resolve({ data, error: next.error ?? null }).then(resolve);
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
  it('B14: deletes by id, and skips the request for an empty list', async () => {
    const { client, requests } = recordingClient();
    const transport = createSupabaseTransport(client);
    await transport.deleteRows('workouts', ['w1', 'w2']);
    await transport.deleteRows('sets', []);
    expect(requests).toEqual([
      [
        ['from', 'workouts'],
        ['delete'],
        ['in', 'id', ['w1', 'w2']],
      ],
    ]);
  });

  it('B14: throws when the server refuses a delete', async () => {
    const { client } = recordingClient([{ error: { message: 'permission denied' } }]);
    await expect(createSupabaseTransport(client).deleteRows('workouts', ['w1'])).rejects.toThrow(
      'Delete from workouts failed: permission denied',
    );
  });

  it('B14: reads the user’s tombstones after an id, in id order', async () => {
    const tombstone = { id: 7, tbl: 'workouts', row_id: 'w1', deleted_at: '2026-11-15T00:00:00+00:00' };
    const { client, requests } = recordingClient([{ data: [tombstone] }]);
    expect(await createSupabaseTransport(client).pullTombstones('u1', 3, 500)).toEqual([tombstone]);
    expect(requests[0]).toEqual([
      ['from', 'sync_tombstones'],
      ['select', 'id,tbl,row_id,deleted_at'],
      ['eq', 'user_id', 'u1'],
      ['gt', 'id', 3],
      ['order', 'id', { ascending: true }],
      ['limit', 500],
    ]);
  });

  it('B15: reads the user’s one settings row, and null when there is none', async () => {
    const row = { user_id: 'u1', unit: 'kg', updated_at: '2026-11-15T00:00:00+00:00' };
    const { client, requests } = recordingClient([{ data: row }, { data: null }]);
    const transport = createSupabaseTransport(client);
    expect(await transport.pullUserSettings('u1')).toEqual(row);
    expect(await transport.pullUserSettings('u1')).toBeNull();
    expect(requests[0]).toEqual([
      ['from', 'user_settings'],
      ['select', 'user_id,unit,updated_at'],
      ['eq', 'user_id', 'u1'],
      ['maybeSingle'],
    ]);
  });

  it('B15: throws when the settings download fails', async () => {
    const { client } = recordingClient([{ data: null, error: { message: 'timeout' } }]);
    await expect(createSupabaseTransport(client).pullUserSettings('u1')).rejects.toThrow(
      'Download of settings failed: timeout',
    );
  });

  it('B15: saves the unit with an update by user id — never an upsert, never updated_at', async () => {
    const { client, requests } = recordingClient();
    await createSupabaseTransport(client).pushUserSettings('u1', 'kg');
    expect(requests[0]).toEqual([
      ['from', 'user_settings'],
      ['update', { unit: 'kg' }],
      ['eq', 'user_id', 'u1'],
    ]);
  });

  it('B15: throws when the server refuses the settings update', async () => {
    const { client } = recordingClient([{ error: { message: 'permission denied' } }]);
    await expect(createSupabaseTransport(client).pushUserSettings('u1', 'lb')).rejects.toThrow(
      'Upload of settings failed: permission denied',
    );
  });

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

  it('B18: asks the analyze-workout function for one workout and stores its reply in the phone’s shape', async () => {
    const reply = { id: 'w1', user_id: 'u1', total_volume_kg: '860.000', new_prs: [{ kind: 'e1rm' }], headline: 'h' };
    const calls: unknown[][] = [];
    const client = {
      functions: {
        invoke: async (...args: unknown[]) => {
          calls.push(args);
          return { data: reply, error: null };
        },
      },
    } as unknown as SupabaseClient;
    const row = await createSupabaseTransport(client).requestAnalysis('w1');
    expect(calls).toEqual([['analyze-workout', { body: { workoutId: 'w1' } }]]);
    expect(row.total_volume_kg).toBe(860);
    expect(row.new_prs).toBe('[{"kind":"e1rm"}]');
  });

  it('B18: throws when the function refuses or errors', async () => {
    const client = {
      functions: { invoke: async () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } }) },
    } as unknown as SupabaseClient;
    await expect(createSupabaseTransport(client).requestAnalysis('w1')).rejects.toThrow('Analysis request failed');
  });

  it('B18: pulls the user’s analyses after a bookmark, converting new_prs to text', async () => {
    const { client, requests } = recordingClient([{ data: [{ id: 'w1', total_volume_kg: 5, new_prs: [] }] }]);
    const rows = await createSupabaseTransport(client).pullWorkoutAnalyses('u1', null, 500);
    expect(rows).toEqual([{ id: 'w1', total_volume_kg: 5, new_prs: '[]' }]);
    expect(requests[0]).toEqual([
      ['from', 'workout_analyses'],
      [
        'select',
        'id,user_id,engine_version,total_volume_kg,total_sets,working_sets,duration_seconds,new_prs,headline,message,workout_updated_at,created_at,updated_at',
      ],
      ['eq', 'user_id', 'u1'],
      ['order', 'updated_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['limit', 500],
    ]);
    expect(toAnalysisRow({ new_prs: '[]', total_volume_kg: 1 }).new_prs).toBe('[]');
  });

  it('pulls entries by workout id and throws on a download error', async () => {
    const { client, requests } = recordingClient([{ error: { message: 'timeout' } }]);
    await expect(createSupabaseTransport(client).pullWorkoutExercises(['w1'])).rejects.toThrow(
      'Download of workout_exercises failed: timeout',
    );
    expect(requests[0]).toContainEqual(['in', 'workout_id', ['w1']]);
    expect(await createSupabaseTransport(client).pullWorkoutExercises([])).toEqual([]);
  });

  const POST = {
    id: 'p1',
    user_id: 'u1',
    flair_id: 'wod',
    workout_id: 'w1',
    visibility: 'public' as const,
    created_at: '2026-11-15T10:00:00.000Z',
  };

  it('B21: uploads a post as an upsert on its id, without updated_at', async () => {
    const { client, requests } = recordingClient([{ data: null }]);
    await createSupabaseTransport(client).pushPost(POST);
    expect(requests[0]).toEqual([
      ['from', 'posts'],
      ['upsert', POST, { onConflict: 'id' }],
    ]);
  });

  it('B21: maps the one-post-per-workout violation (23505) to PostAlreadyExistsError, other errors to plain ones', async () => {
    const duplicate = { message: 'duplicate key value violates unique constraint "posts_workout_unique"', code: '23505' };
    const { client } = recordingClient([{ error: duplicate }, { error: { message: 'permission denied' } }]);
    const transport = createSupabaseTransport(client);
    await expect(transport.pushPost(POST)).rejects.toBeInstanceOf(PostAlreadyExistsError);
    const plain = transport.pushPost(POST);
    await expect(plain).rejects.toThrow('Upload of post failed: permission denied');
    await expect(plain).rejects.not.toBeInstanceOf(PostAlreadyExistsError);
  });

  it('B21: reads the whole flair list in position order, and throws on an error', async () => {
    const flair = { id: 'wod', name: 'WOD', position: 1, upvotes_only: false };
    const { client, requests } = recordingClient([{ data: [flair] }, { error: { message: 'timeout' } }]);
    const transport = createSupabaseTransport(client);
    expect(await transport.pullFlairs()).toEqual([flair]);
    expect(requests[0]).toEqual([
      ['from', 'flairs'],
      ['select', 'id,name,position,upvotes_only'],
      ['order', 'position', { ascending: true }],
    ]);
    await expect(transport.pullFlairs()).rejects.toThrow('Download of flairs failed: timeout');
  });
});
