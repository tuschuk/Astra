/**
 * Tests for the Marketplace program page (B40 — MKT-4, MKT-5), with the fake client for the
 * server reads and real SQLite for the copy and the run:
 *   - MKT-4: the page shows the author, "2 weeks", "2–3 days/week" and every workout with every
 *     exercise and its targets; the author line opens their profile;
 *   - MKT-5: one tap of Save and Start copies the program into my programs, makes it my active
 *     run (Week 1 · Day A next) and goes to the Workout tab; the buttons are then spent; a
 *     running program is flagged first; Save to my programs copies without starting; custom
 *     exercises that didn't copy are counted and the page stays put;
 *   - my own program offers the editor, not a copy; an empty program can't be saved or started;
 *     a gone program says so; no connection shows the message and Retry recovers;
 *   - (B41 — MKT-3) a published program shows its score with my vote lit, both arrows and the
 *     comment count; a tap moves the score at once and rewrites my one vote row (again takes it
 *     back); a refusal steps back with the sentence; the comments button opens the program's
 *     comments, and coming back re-reads the numbers; a followers-only program shows neither.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { readActiveRun, startProgramRun } from '@/programs/programRuns';
import { addProgramWorkout, addWeek, createProgram, listPrograms } from '@/programs/programs';
import type { TeamProgramPayload } from '@/social/teamCoaching';
import { VOTE_REFUSAL_MESSAGES } from '@/social/votes';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import MarketplaceProgramScreen, {
  MARKETPLACE_SAVED,
  MARKETPLACE_STARTED,
  NO_WORKOUTS,
  PROGRAM_PAGE_GONE,
  PROGRAM_PAGE_OFFLINE,
  REPLACES_RUN,
} from '@/app/marketplace-program/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockProgramId = 'p1';
// (B41) Focus callbacks are kept so a test can "come back to the page" with `refocus()`.
const mockFocusCallbacks: (() => void)[] = [];
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockProgramId }),
    useFocusEffect: (effect: () => void) =>
      useEffect(() => {
        mockFocusCallbacks.push(effect);
        effect();
      }, [effect]),
  };
});

/** The lifter comes back to the page (from its comments, say). */
async function refocus(): Promise<void> {
  await act(async () => mockFocusCallbacks[mockFocusCallbacks.length - 1]?.());
}

const ME = SIGNED_IN_USER_ID;
const SQUAT = libraryExerciseId('squat');
const BENCH = libraryExerciseId('bench_press');
const AUTHOR_CUSTOM = 'c0000000-0000-4000-8000-0000000000ff';

const slot = (exerciseId: string, exerciseName: string, position: number, extra: Partial<TeamProgramPayload['weeks'][0]['workouts'][0]['exercises'][0]> = {}) => ({
  exerciseId,
  exerciseName,
  position,
  targetSets: 3,
  targetReps: 5,
  targetWeightKg: 100,
  targetRpe: 8,
  ...extra,
});

/** 2 weeks: week 1 has Day A and Day B, week 2 adds Day C — so "2–3 days/week". */
const basics: TeamProgramPayload = {
  name: 'Barbell Basics',
  weeks: [
    {
      position: 0,
      workouts: [
        { name: 'Day A', position: 0, exercises: [slot(SQUAT, 'Squat', 0), slot(BENCH, 'Bench Press', 1, { targetReps: 8, targetWeightKg: null, targetRpe: null })] },
        { name: 'Day B', position: 1, exercises: [slot(SQUAT, 'Squat', 0, { targetSets: 5 })] },
      ],
    },
    {
      position: 1,
      workouts: [
        { name: 'Day A', position: 0, exercises: [slot(SQUAT, 'Squat', 0)] },
        { name: 'Day B', position: 1, exercises: [] },
        { name: 'Day C', position: 2, exercises: [slot(AUTHOR_CUSTOM, 'Alex Sled Drag', 0, { targetReps: null, targetWeightKg: null, targetRpe: null })] },
      ],
    },
  ],
};

/** A payload as `program_payload` sends it over the wire (snake_case), so the page's parser really runs. */
function asServerJson(payload: TeamProgramPayload | null): unknown {
  if (!payload) return null;
  return {
    name: payload.name,
    weeks: payload.weeks.map((w) => ({
      position: w.position,
      workouts: w.workouts.map((wo) => ({
        name: wo.name,
        position: wo.position,
        exercises: wo.exercises.map((s) => ({
          exercise_id: s.exerciseId,
          exercise_name: s.exerciseName,
          position: s.position,
          target_sets: s.targetSets,
          target_reps: s.targetReps,
          target_weight_kg: s.targetWeightKg,
          target_rpe: s.targetRpe,
        })),
      })),
    })),
  };
}

let payloads: Record<string, TeamProgramPayload | null>;
let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
  mockProgramId = 'p1';
  payloads = {
    p1: basics,
    simple: { name: 'Simple', weeks: [{ position: 0, workouts: [basics.weeks[0].workouts[0]] }] },
    empty: { name: 'Empty', weeks: [] },
    mine: basics,
    gone: null,
  };
  const row = (id: string, name: string, userId = 'alex') => ({
    id,
    user_id: userId,
    name,
    visibility: 'published',
    deleted_at: null,
    created_at: '2026-11-15T10:00:00.000Z',
  });
  mockSocial = createFakeSocialClient(
    {
      profiles: [profile('alex', 'alex_lifts', 'Alex'), profile(ME, 'me_lifts', 'Me')],
      programs: [row('p1', 'Barbell Basics'), row('simple', 'Simple'), row('empty', 'Empty'), row('mine', 'Barbell Basics', ME), row('gone', 'Gone')],
    },
    { rpc: { program_payload: (p) => asServerJson(payloads[String(p.p_program)] ?? null) } },
  );
});

describe('Marketplace program page', () => {
  it('MKT-4: author, length, days per week and every workout’s contents', async () => {
    await renderSignedIn(<MarketplaceProgramScreen />);
    expect(await screen.findByText('Barbell Basics')).toBeTruthy();
    expect(screen.getByText('by Alex')).toBeTruthy();
    expect(screen.getByText('2 weeks · 2–3 days/week')).toBeTruthy();
    expect(screen.getByText('Week 1')).toBeTruthy();
    expect(screen.getByText('Week 2')).toBeTruthy();
    expect(screen.getAllByText('Day A')).toHaveLength(2);
    expect(screen.getAllByText('Day B')).toHaveLength(2);
    expect(screen.getByText('Day C')).toBeTruthy();
    expect(screen.getAllByText('Squat')).toHaveLength(3);
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Alex Sled Drag')).toBeTruthy();
    expect(screen.getByText('5 × 5 @ 220.5 lb · RPE 8')).toBeTruthy();
    expect(screen.getByText('3 × 8')).toBeTruthy();
    expect(screen.getByText('No exercises yet.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Open Alex's profile"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/profile/[id]', params: { id: 'alex' } });
  });

  it('MKT-5: one tap of Save and Start saves it, makes it the active program and opens the Workout tab', async () => {
    mockProgramId = 'simple';
    await renderSignedIn(<MarketplaceProgramScreen />);
    await fireEvent.press(await screen.findByLabelText('Save and Start'));
    expect(await screen.findByText(MARKETPLACE_STARTED)).toBeTruthy();
    expect(mockRouter.push).toHaveBeenCalledWith('/workout');
    const active = await readActiveRun(db, ME);
    expect(active?.tree.program).toMatchObject({ name: 'Simple', user_id: ME, visibility: 'private' });
    expect(active?.nextSession?.week.number).toBe(1);
    expect(active?.nextSession?.workout.label).toBe('Day A');
    // Spent: no second copy is possible.
    expect(screen.queryByLabelText('Save and Start')).toBeNull();
    expect(screen.queryByLabelText('Save to my programs')).toBeNull();
    expect(await listPrograms(db, ME)).toHaveLength(1);
  });

  it('custom exercises that didn’t copy are counted, and the page stays put with a way on', async () => {
    await renderSignedIn(<MarketplaceProgramScreen />);
    await fireEvent.press(await screen.findByLabelText('Save and Start'));
    expect(await screen.findByText(`${MARKETPLACE_STARTED} 1 exercise is the author’s own and didn’t copy.`)).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalledWith('/workout');
    await fireEvent.press(screen.getByLabelText('Go to the Workout tab'));
    expect(mockRouter.push).toHaveBeenCalledWith('/workout');
  });

  it('a program already running is flagged before Save and Start replaces it', async () => {
    const own = await createProgram(db, ME, 'Mine');
    const week = await addWeek(db, ME, own.id);
    await addProgramWorkout(db, ME, week.id, 'Mine A');
    await startProgramRun(db, ME, own.id);
    mockProgramId = 'simple';
    await renderSignedIn(<MarketplaceProgramScreen />);
    expect(await screen.findByText(REPLACES_RUN)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Save and Start'));
    await screen.findByText(MARKETPLACE_STARTED);
    expect((await readActiveRun(db, ME))?.tree.program.name).toBe('Simple');
  });

  it('Save to my programs copies it without starting a run', async () => {
    mockProgramId = 'simple';
    await renderSignedIn(<MarketplaceProgramScreen />);
    await fireEvent.press(await screen.findByLabelText('Save to my programs'));
    expect(await screen.findByText(MARKETPLACE_SAVED)).toBeTruthy();
    expect((await listPrograms(db, ME)).map((p) => p.program.name)).toEqual(['Simple']);
    expect(await readActiveRun(db, ME)).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Save and Start')).toBeNull();
  });

  it('my own program offers the editor instead of a copy', async () => {
    mockProgramId = 'mine';
    await renderSignedIn(<MarketplaceProgramScreen />);
    expect(await screen.findByText('This is your program.')).toBeTruthy();
    expect(screen.queryByLabelText('Save and Start')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Open in editor'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/program/[id]', params: { id: 'mine' } });
  });

  it('a program with no workouts can’t be saved or started', async () => {
    mockProgramId = 'empty';
    await renderSignedIn(<MarketplaceProgramScreen />);
    expect(await screen.findByText(NO_WORKOUTS)).toBeTruthy();
    expect(screen.getByText('0 weeks · 0 days/week')).toBeTruthy();
    expect(screen.queryByLabelText('Save and Start')).toBeNull();
  });

  it('a program no longer visible says so (no row, or no payload)', async () => {
    mockProgramId = 'gone';
    await renderSignedIn(<MarketplaceProgramScreen />);
    expect(await screen.findByText(PROGRAM_PAGE_GONE)).toBeTruthy();
  });

  it('offline: the connection message; Retry loads the page', async () => {
    mockSocial.setOffline(true);
    await renderSignedIn(<MarketplaceProgramScreen />);
    expect(await screen.findByText(PROGRAM_PAGE_OFFLINE)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('2 weeks · 2–3 days/week')).toBeTruthy();
  });
});

describe('Marketplace program page — votes and comments (B41, MKT-3)', () => {
  /** The score on screen. */
  function shownScore(): string {
    return String(screen.getByTestId('program-score').props.accessibilityLabel);
  }

  beforeEach(() => {
    mockFocusCallbacks.length = 0;
    mockSocial.tables.program_votes.push(
      { program_id: 'p1', user_id: 'alex', value: 1 },
      { program_id: 'p1', user_id: 'x', value: 1 },
      { program_id: 'p1', user_id: ME, value: 1 },
    );
    mockSocial.tables.program_comments.push({ id: 'c1', program_id: 'p1', user_id: 'alex', body: 'Run it', created_at: '2026-11-15T10:00:00.000Z' });
  });

  it('shows the score with my vote lit, both arrows, and the comment count', async () => {
    await renderSignedIn(<MarketplaceProgramScreen />);
    await screen.findByText('Barbell Basics');
    expect(shownScore()).toBe('Score 3');
    expect(screen.getByLabelText('Upvote').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Downvote')).toBeTruthy();
    expect(screen.getByText('1 comment')).toBeTruthy();
  });

  it('a tap moves the score at once and rewrites my one vote row; tapping again takes it back', async () => {
    await renderSignedIn(<MarketplaceProgramScreen />);
    await screen.findByText('Barbell Basics');
    await fireEvent.press(screen.getByLabelText('Downvote'));
    expect(shownScore()).toBe('Score 1');
    const mine = () => mockSocial.tables.program_votes.filter((v) => v.user_id === ME);
    expect(mine()).toEqual([{ program_id: 'p1', user_id: ME, value: -1 }]);
    await fireEvent.press(screen.getByLabelText('Downvote'));
    expect(shownScore()).toBe('Score 2');
    expect(mine()).toEqual([]);
  });

  it('a refused vote steps back and says so', async () => {
    mockSocial = createFakeSocialClient(
      { profiles: [profile('alex', 'alex_lifts', 'Alex')], programs: [...mockSocial.tables.programs] },
      {
        rpc: { program_payload: (p) => asServerJson(payloads[String(p.p_program)] ?? null) },
        refuse: { program_votes: { code: '42501', message: 'row-level security' } },
      },
    );
    await renderSignedIn(<MarketplaceProgramScreen />);
    await screen.findByText('Barbell Basics');
    expect(shownScore()).toBe('Score 0');
    await fireEvent.press(screen.getByLabelText('Upvote'));
    expect(shownScore()).toBe('Score 0');
    expect(screen.getByText(VOTE_REFUSAL_MESSAGES.failed)).toBeTruthy();
  });

  it('the comments button opens the program’s comments; coming back re-reads the numbers', async () => {
    await renderSignedIn(<MarketplaceProgramScreen />);
    await fireEvent.press(await screen.findByLabelText('1 comment'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/program-comments/[id]', params: { id: 'p1' } });
    // While away: a second comment and another upvote land.
    mockSocial.tables.program_comments.push({ id: 'c2', program_id: 'p1', user_id: ME, body: 'Will do', created_at: '2026-11-15T11:00:00.000Z' });
    mockSocial.tables.program_votes.push({ program_id: 'p1', user_id: 'y', value: 1 });
    await refocus();
    expect(await screen.findByText('2 comments')).toBeTruthy();
    expect(shownScore()).toBe('Score 4');
  });

  it('a program that isn’t published (shared with followers or a team) shows no votes or comments', async () => {
    mockSocial.tables.programs.push({
      id: 'shared',
      user_id: 'alex',
      name: 'Followers Only',
      visibility: 'followers',
      deleted_at: null,
      created_at: '2026-11-15T10:00:00.000Z',
    });
    payloads.shared = { ...basics, name: 'Followers Only' };
    mockProgramId = 'shared';
    await renderSignedIn(<MarketplaceProgramScreen />);
    await screen.findByText('Followers Only');
    expect(screen.queryByLabelText('Upvote')).toBeNull();
    expect(screen.queryByLabelText('Comment')).toBeNull();
  });
});
