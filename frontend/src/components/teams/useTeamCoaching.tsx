/**
 * useTeamCoaching — everything coaching adds to a team's page (B37 — TEAM-3), kept out of the
 * route file so the page stays readable.
 *
 * What it holds: the team's pushes (newest 20), the programs assigned to the viewer, and — for a
 * coach — every standing assignment; the pushed and assigned programs' contents (fetched once
 * per load, so the cards can name them and the sheet opens at once); and the open sheets.
 *
 * What it lets the page offer:
 *   - members: open a pushed announcement / program / workout; **Start** or **Dismiss** an
 *     assigned program. Start copies the program into the member's own programs, starts running
 *     it, then removes the assignment — from that tap, the Workout tab shows the run. A pushed
 *     program can be **saved** (copied, no run); a pushed workout **started** in the logger.
 *   - coaches (the owner and coaches): **Push an announcement**, **Push a program**, **Push a
 *     workout**, **Assign a program** to a member, revoke an assignment, remove their own push;
 *   - the owner: **Make coach** / **Remove coach** on a member's row.
 * Every change re-reads the page (`onChanged`). Refusals come back as a sentence in `message`.
 *
 * The copy and the run start are saved on the phone; reading the payload and removing the
 * assignment need the connection the team page already requires. A kill between the two leaves
 * a saved program and a standing assignment — tapping Start again makes a second copy, which
 * the lifter can delete (an accepted, recorded trade-off).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';

import { ProgramPickerSheet } from '@/components/programs/ProgramPickerSheet';
import type { SqlDriver } from '@/db/driver';
import { createProgramFromPayload, skippedExercisesLine } from '@/programs/copyProgram';
import { startProgramRun } from '@/programs/programRuns';
import { listPrograms } from '@/programs/programs';
import { useDisplayUnit } from '@/settings/displayUnit';
import {
  assignProgram,
  deleteTeamPost,
  fetchProgramPayload,
  fetchWorkoutPayload,
  loadTeamPosts,
  myAssignments,
  pushAnnouncement,
  pushProgram,
  pushWorkout,
  removeAssignment,
  teamAssignments,
  type TeamAssignment,
  type TeamPost,
  type TeamProgramPayload,
  type TeamWorkoutPayload,
} from '@/social/teamCoaching';
import { setMemberRole, type TeamResult } from '@/social/teams';
import { startPushedWorkout } from '@/workout/startPushedWorkout';

import { CoachPushSheet, type CoachPushMode } from './CoachPushSheet';
import { TeamProgramSheet, type TeamSheetContent } from './TeamProgramSheet';

/** The line every member sees: coaching includes reading the training log. */
export const COACH_LOG_NOTICE = 'Coaches of this team can see your training log.';

/** Shown after an assigned program was copied and started. */
export const ASSIGNMENT_STARTED = 'Program started. Find it on the Workout tab.';

/** Shown when the copy was saved but its run couldn't start (the copy is in Your programs). */
export const ASSIGNMENT_SAVED_NOT_STARTED =
  'Saved to your programs, but it couldn’t be started here. Start it from the Workout tab.';

/** Shown after a pushed program was saved. */
export const PROGRAM_SAVED = 'Saved to your programs.';

/** Shown when a pushed workout can't start (most likely: a workout is already in progress). */
export const PUSHED_WORKOUT_FAILED = 'The workout couldn’t be started. If one is in progress, resume it.';

/** The key a payload is cached under. */
function payloadKey(kind: 'program' | 'workout', id: string): string {
  return `${kind}:${id}`;
}

/** Why the program picker is open: which push or assignment it chooses for. */
type PickerPurpose = { kind: 'push-program' } | { kind: 'push-workout' } | { kind: 'assign'; userId: string };

/** The sheet that is open, what its footer acts on, and whether that action is already done. */
type OpenSheet = { done?: boolean } & (
  | { content: Extract<TeamSheetContent, { kind: 'assignment' }>; programId: string }
  | { content: Extract<TeamSheetContent, { kind: 'program' }> }
  | { content: Extract<TeamSheetContent, { kind: 'workout' }> }
);

export interface UseTeamCoachingArgs {
  client: SupabaseClient;
  db: SqlDriver | null;
  me: string | null;
  teamId: string;
  /** Re-read the whole page after a change (roles, pushes, assignments). */
  onChanged: () => void;
}

export function useTeamCoaching({ client, db, me, teamId, onChanged }: UseTeamCoachingArgs) {
  const router = useRouter();
  const unit = useDisplayUnit();
  const [posts, setPosts] = useState<TeamPost[]>([]);
  const [mine, setMine] = useState<TeamAssignment[]>([]);
  const [all, setAll] = useState<TeamAssignment[]>([]);
  const [payloads, setPayloads] = useState<Map<string, TeamProgramPayload | TeamWorkoutPayload | null>>(new Map());
  const [ownNames, setOwnNames] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<PickerPurpose | null>(null);
  const [pushMode, setPushMode] = useState<CoachPushMode | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const generation = useRef(0);

  /**
   * Reads the coaching side of the page for a member (`isMember`), and the whole team's
   * assignments for a coach (`isCoach`), then fetches the contents of every pushed or assigned
   * program once. A non-member gets nothing (the server would show nothing anyway). Throws on
   * failure, like the page's own reads.
   */
  const reload = useCallback(
    async (isMember: boolean, isCoach: boolean) => {
      const run = ++generation.current;
      if (!me || !isMember) {
        setPosts([]);
        setMine([]);
        setAll([]);
        return;
      }
      const [nextPosts, nextMine, nextAll, names] = await Promise.all([
        loadTeamPosts(client, teamId),
        myAssignments(client, me, teamId),
        isCoach ? teamAssignments(client, teamId) : Promise.resolve([]),
        isCoach && db
          ? listPrograms(db, me).catch((caught: unknown) => {
              // Only names for the coach's assignment rows; the page still works without them.
              console.warn('Team: the coach’s programs could not be read', caught);
              return [];
            })
          : Promise.resolve([]),
      ]);
      if (run !== generation.current) return;
      setPosts(nextPosts);
      setMine(nextMine);
      setAll(nextAll);
      setOwnNames(new Map(names.map((s) => [s.program.id, s.program.name])));
      // Each referenced program / workout once, in parallel; a failed fetch just leaves it unnamed.
      const wanted = new Map<string, () => Promise<TeamProgramPayload | TeamWorkoutPayload | null | undefined>>();
      const programFetch = (id: string) => async () => {
        const r = await fetchProgramPayload(client, teamId, id);
        return r.ok ? r.payload : undefined;
      };
      for (const p of nextPosts) {
        if (p.kind === 'program' && p.programId) wanted.set(payloadKey('program', p.programId), programFetch(p.programId));
        if (p.kind === 'workout' && p.programWorkoutId) {
          const id = p.programWorkoutId;
          wanted.set(payloadKey('workout', id), async () => {
            const r = await fetchWorkoutPayload(client, teamId, id);
            return r.ok ? r.payload : undefined;
          });
        }
      }
      for (const a of nextMine) wanted.set(payloadKey('program', a.programId), programFetch(a.programId));
      const entries = await Promise.all([...wanted].map(async ([key, get]) => [key, await get()] as const));
      if (run !== generation.current) return;
      setPayloads(new Map(entries.filter((e): e is [string, TeamProgramPayload | TeamWorkoutPayload | null] => e[1] !== undefined)));
    },
    [client, db, me, teamId],
  );

  /** A cached program payload's name, or null when it hasn't been (or can't be) fetched. */
  function programName(programId: string): string | null {
    const p = payloads.get(payloadKey('program', programId)) as TeamProgramPayload | null | undefined;
    return p?.name ?? ownNames.get(programId) ?? null;
  }

  /** A cached workout payload's "<workout> · <program>" name, or null. */
  function workoutName(programWorkoutId: string): string | null {
    const w = payloads.get(payloadKey('workout', programWorkoutId)) as TeamWorkoutPayload | null | undefined;
    return w ? `${w.name ?? 'Workout'} · ${w.programName}` : null;
  }

  /** Runs one change, shows its refusal, then re-reads the page. */
  async function act(action: () => Promise<TeamResult>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setMessage(result.message);
    onChanged();
    return result.ok;
  }

  /** Fresh program payload (falls back to the cache when the fetch fails). */
  async function programPayload(programId: string): Promise<TeamProgramPayload | null> {
    const r = await fetchProgramPayload(client, teamId, programId);
    if (r.ok) return r.payload;
    return (payloads.get(payloadKey('program', programId)) as TeamProgramPayload | null | undefined) ?? null;
  }

  /** Opens a push: an announcement has nothing to open; a program or workout opens the sheet. */
  async function openPost(post: TeamPost): Promise<void> {
    setSheetMessage(null);
    if (post.kind === 'program' && post.programId) {
      setSheet({ content: { kind: 'program', payload: await programPayload(post.programId) } });
    } else if (post.kind === 'workout' && post.programWorkoutId) {
      const r = await fetchWorkoutPayload(client, teamId, post.programWorkoutId);
      const cached = payloads.get(payloadKey('workout', post.programWorkoutId)) as TeamWorkoutPayload | null | undefined;
      setSheet({ content: { kind: 'workout', payload: r.ok ? r.payload : (cached ?? null) } });
    }
  }

  /** Opens one of the viewer's assignments in the sheet, with Start. */
  async function openAssignment(assignment: TeamAssignment): Promise<void> {
    setSheetMessage(null);
    setSheet({
      content: { kind: 'assignment', payload: await programPayload(assignment.programId) },
      programId: assignment.programId,
    });
  }

  /** The sheet's footer: start the assignment, save the program, or start the workout. */
  async function sheetAction(): Promise<void> {
    if (!sheet || sheet.done || !db || !me || busy || !sheet.content.payload) return;
    setBusy(true);
    setSheetMessage(null);
    try {
      if (sheet.content.kind === 'workout') {
        try {
          await startPushedWorkout(db, me, sheet.content.payload, unit);
        } catch (caught) {
          console.warn('Team: the pushed workout could not start', caught);
          setSheetMessage(PUSHED_WORKOUT_FAILED);
          return;
        }
        setSheet(null);
        router.push('/active-workout');
        return;
      }
      let copy;
      try {
        copy = await createProgramFromPayload(db, me, sheet.content.payload);
      } catch (caught) {
        console.warn('Team: the program could not be copied', caught);
        setSheetMessage('That program couldn’t be saved on this phone. Try again.');
        return;
      }
      // From here the copy exists: the footer action is spent (a second tap would copy again).
      setSheet((prev) => (prev ? { ...prev, done: true } : prev));
      const skipped = skippedExercisesLine(copy.skippedExercises);
      if (sheet.content.kind === 'program') {
        setSheetMessage([PROGRAM_SAVED, skipped].filter(Boolean).join(' '));
        return;
      }
      try {
        await startProgramRun(db, me, copy.programId);
      } catch (caught) {
        console.warn('Team: the copied program could not be started', caught);
        setSheetMessage(ASSIGNMENT_SAVED_NOT_STARTED);
        return;
      }
      // The run is saved on the phone; consuming the assignment is best effort (it can be retried).
      const consumed = 'programId' in sheet ? await removeAssignment(client, teamId, me, sheet.programId) : { ok: true };
      setSheetMessage(
        [ASSIGNMENT_STARTED, skipped, consumed.ok ? null : 'The assignment will clear next time.'].filter(Boolean).join(' '),
      );
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  /** The program picker reported a pick: push it, choose one of its workouts, or assign it. */
  async function picked(programId: string): Promise<void> {
    const purpose = picker;
    setPicker(null);
    if (!me || !purpose) return;
    if (purpose.kind === 'push-program') await act(() => pushProgram(client, me, teamId, programId));
    else if (purpose.kind === 'push-workout') {
      setPushMessage(null);
      setPushMode({ kind: 'workout', programId });
    } else await act(() => assignProgram(client, me, teamId, purpose.userId, programId));
  }

  /**
   * Sends one push from the push sheet (an announcement, or a picked workout): a refusal stays in
   * the sheet as a line; success closes it and re-reads the page.
   */
  async function sendFromSheet(push: (coach: string) => Promise<TeamResult>): Promise<void> {
    if (!me || busy) return;
    setBusy(true);
    setPushMessage(null);
    const result = await push(me);
    setBusy(false);
    if (!result.ok) {
      setPushMessage(result.message);
      return;
    }
    setPushMode(null);
    onChanged();
  }

  const modals = (
    <>
      <ProgramPickerSheet
        visible={picker !== null}
        db={db}
        userId={me}
        onPick={(id) => void picked(id)}
        title={picker?.kind === 'assign' ? 'Assign a program' : picker?.kind === 'push-workout' ? 'Push a workout' : 'Push a program'}
        intro={
          picker?.kind === 'assign'
            ? 'Pick one of your programs. The lifter sees it on this team’s page and starts it with one tap.'
            : picker?.kind === 'push-workout'
              ? 'Pick the program the workout is in.'
              : 'Pick one of your programs. Every member can view it and save a copy.'
        }
        onOpenPrograms={() => {
          setPicker(null);
          router.push('/programs');
        }}
        onClose={() => setPicker(null)}
      />
      <CoachPushSheet
        key={pushMode ? (pushMode.kind === 'workout' ? `workout:${pushMode.programId}` : 'announcement') : 'closed'}
        mode={pushMode}
        db={db}
        userId={me}
        busy={busy}
        message={pushMessage}
        onPushAnnouncement={(body) => void sendFromSheet((coach) => pushAnnouncement(client, coach, teamId, body))}
        onPushWorkout={(id) => void sendFromSheet((coach) => pushWorkout(client, coach, teamId, id))}
        onClose={() => setPushMode(null)}
      />
      <TeamProgramSheet
        content={sheet?.content ?? null}
        unit={unit}
        busy={busy}
        done={sheet?.done ?? false}
        message={sheetMessage}
        onAction={() => void sheetAction()}
        onClose={() => setSheet(null)}
      />
    </>
  );

  return {
    posts,
    myAssignments: mine,
    /** Every standing assignment of `userId` (the coach's view). */
    assignmentsOf: (userId: string) => all.filter((a) => a.userId === userId),
    programName,
    workoutName,
    message,
    busy,
    reload,
    openPost: (post: TeamPost) => void openPost(post),
    openAssignment: (a: TeamAssignment) => void openAssignment(a),
    dismissAssignment: (a: TeamAssignment) => void act(() => removeAssignment(client, teamId, a.userId, a.programId)),
    revokeAssignment: (a: TeamAssignment) => void act(() => removeAssignment(client, teamId, a.userId, a.programId)),
    deletePost: (post: TeamPost) => void act(() => deleteTeamPost(client, post.id)),
    setRole: (userId: string, role: 'coach' | 'member') => void act(() => setMemberRole(client, teamId, userId, role)),
    startAssign: (userId: string) => setPicker({ kind: 'assign', userId }),
    startPushProgram: () => setPicker({ kind: 'push-program' }),
    startPushWorkout: () => setPicker({ kind: 'push-workout' }),
    startPushAnnouncement: () => {
      setPushMessage(null);
      setPushMode({ kind: 'announcement' });
    },
    modals,
  };
}
