/**
 * Marketplace program page — one published program, in full (B40 — MKT-4, MKT-5). Opened by
 * tapping a card on the Marketplace tab.
 *
 * What it shows: the program's name; "by <author>" (tap it to open the author's profile); its
 * length and days per week ("8 weeks · 3 days/week", or "2–3 days/week" when weeks differ); then
 * the full breakdown — every week, every workout, every exercise with its targets in the
 * lifter's unit (the same drawing a team member sees for a coach's program).
 *
 * What the user can do:
 *   - **Save and Start** — one tap copies the program into their own programs and makes it the
 *     active program; the app then goes to the Workout tab, which offers its first session. If a
 *     program is already running, the page says first that this replaces it (MKT-5);
 *   - **Save to my programs** — just the copy, nothing started;
 *   - on their OWN program, neither (a copy of your own program is never what you mean): "This is
 *     your program" and **Open in editor** instead.
 * A copy is made once — after it, both buttons go away (a second tap would copy again). If some
 * exercises are the author's own custom ones, the page says how many didn't copy and stays put
 * with a "Go to the Workout tab" button so the lifter reads it. A program with no workouts can't
 * be started or saved and says so.
 *
 * (B41 — MKT-3) On a PUBLISHED program, under the facts line: the vote arrows around its net
 * score (tap to vote up or down, tap the lit one to take it back — exactly as on a feed post; the
 * score moves at once and back with a message if refused), and a comments button ("3 comments" /
 * "Comment") that opens `/program-comments/[id]`. Coming back to the page reads it again, so the
 * numbers are the server's. A program shared only with followers or a team shows neither — the
 * server takes votes and comments on published programs only.
 *
 * Reading the program needs a connection (no signal → the standard message with Retry); a
 * program that is gone or no longer published says "no longer available". The copy and the run
 * are saved on the phone and work from then on offline, like any program the lifter built.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { ProgramPayloadView } from '@/components/programs/ProgramPayloadView';
import { Screen } from '@/components/Screen';
import { commentButtonLabel } from '@/components/social/PostCard';
import { VoteControl } from '@/components/social/VoteControl';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading } from '@/components/ui/Text';
import { useAppDatabase } from '@/db/useAppDatabase';
import { getSupabase } from '@/lib/supabase';
import { skippedExercisesLine } from '@/programs/copyProgram';
import { readActiveRun } from '@/programs/programRuns';
import { saveAndStartProgram, saveProgramOnly } from '@/programs/saveAndStart';
import { useDisplayUnit } from '@/settings/displayUnit';
import { loadProgramPage, programFacts, programFactsLine, type MarketplacePage } from '@/social/marketplace';
import { personLabels } from '@/social/names';
import { castProgramVote, clearProgramVote } from '@/social/votes';
import { colors, spacing } from '@/theme';

/** Shown when the program can't be read for want of a connection (or the read failed). */
export const PROGRAM_PAGE_OFFLINE = 'This program needs a connection to load. Your own programs still work offline.';

/** Shown when the server no longer hands the program over (deleted, or no longer published). */
export const PROGRAM_PAGE_GONE = 'This program is no longer available.';

/** Beside Save and Start when a program is already running (B35: starting another one ends it). */
export const REPLACES_RUN = 'This will replace your current program.';

/** Shown instead of the buttons when the program has no workout to save or start. */
export const NO_WORKOUTS = 'This program has no workouts yet.';

/** Shown after Save to my programs. */
export const MARKETPLACE_SAVED = 'Saved to your programs.';

/** Shown when the copy was made and started (before the app moves to the Workout tab). */
export const MARKETPLACE_STARTED = 'Saved and started. Find it on the Workout tab.';

/** Shown when the copy was saved but its run couldn't start. */
export const MARKETPLACE_SAVED_NOT_STARTED =
  'Saved to your programs, but it couldn’t be started here. Start it from the Workout tab.';

/** Shown when the copy itself failed (nothing was saved). */
export const MARKETPLACE_SAVE_FAILED = 'That program couldn’t be saved on this phone. Try again.';

/** Reading; read; gone (null page); or the read failed. */
type Load = { status: 'loading' } | { status: 'ready'; page: MarketplacePage } | { status: 'gone' } | { status: 'failed' };

export default function MarketplaceProgramScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const programId = typeof id === 'string' ? id : '';
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const { db } = useAppDatabase();
  const unit = useDisplayUnit();
  const client = useMemo(() => getSupabase(), []);
  const [load, setLoad] = useState<{ forId: string; state: Load } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  // Null until a copy lands; then whether it was only saved or also started (the buttons are spent).
  const [done, setDone] = useState<'saved' | 'started' | 'not-started' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const acting = useRef(false);

  // (B41) Coming back to the page (e.g. from its comments) reads it again, so the score and the
  // comment count are the server's current ones. The first focus is the opening read itself.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setAttempt((n) => n + 1);
    }, []),
  );

  // Read the program from the server (again on Retry and on returning to the page). The page
  // already shown stays up while a re-read is on its way.
  useEffect(() => {
    if (programId === '') return;
    let current = true;
    loadProgramPage(client, programId, me)
      .then((page) => {
        if (current) setLoad({ forId: programId, state: page ? { status: 'ready', page } : { status: 'gone' } });
      })
      .catch((error: unknown) => {
        console.warn('Marketplace program: could not be read', error);
        if (current) setLoad({ forId: programId, state: { status: 'failed' } });
      });
    return () => {
      current = false;
    };
  }, [client, programId, me, attempt]);

  // Is a program already running on this phone? Only decides whether to show REPLACES_RUN.
  useEffect(() => {
    if (!db || !me) return;
    let current = true;
    readActiveRun(db, me)
      .then((run) => {
        if (current) setRunning(run !== null);
      })
      .catch((error: unknown) => console.warn('Marketplace program: the active run could not be read', error));
    return () => {
      current = false;
    };
  }, [db, me]);

  const state: Load = programId === '' ? { status: 'gone' } : load?.forId === programId ? load.state : { status: 'loading' };

  /** Back to the Marketplace (or wherever this was opened from). */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/marketplace');
  }

  /**
   * The two copy buttons. `start` true → Save and Start (the shared home), else save only.
   * Runs once at a time; after a copy lands both buttons are spent.
   */
  async function copy(start: boolean): Promise<void> {
    if (state.status !== 'ready' || !state.page.payload || !db || !me || done || acting.current) return;
    acting.current = true;
    setBusy(true);
    setMessage(null);
    const payload = state.page.payload;
    try {
      let result;
      try {
        result = await (start ? saveAndStartProgram : saveProgramOnly)(db, me, payload);
      } catch (error) {
        console.warn('Marketplace program: the copy could not be saved', error);
        setMessage(MARKETPLACE_SAVE_FAILED);
        return;
      }
      const outcome = !start ? 'saved' : result.started ? 'started' : 'not-started';
      setDone(outcome);
      const skipped = skippedExercisesLine(result.skippedExercises, 'author');
      const words = { saved: MARKETPLACE_SAVED, started: MARKETPLACE_STARTED, 'not-started': MARKETPLACE_SAVED_NOT_STARTED };
      setMessage([words[outcome], skipped].filter(Boolean).join(' '));
      // Started with nothing to explain → straight to the logger, where the run card now waits.
      if (start && result.started && !skipped) router.push('/workout');
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (state.status === 'loading') {
    return (
      <Screen>
        {backButton}
        <Body variant="muted">Loading program…</Body>
      </Screen>
    );
  }
  if (state.status === 'failed') {
    return (
      <Screen>
        {backButton}
        <EmptyState icon="cloud-offline-outline" message={PROGRAM_PAGE_OFFLINE} actionLabel="Retry" onAction={() => setAttempt((n) => n + 1)} />
      </Screen>
    );
  }
  if (state.status === 'gone' || !state.page.payload) {
    return (
      <Screen>
        {backButton}
        <EmptyState icon="calendar-outline" message={PROGRAM_PAGE_GONE} />
      </Screen>
    );
  }

  const { summary, payload } = state.page;
  const facts = programFacts(payload);
  const author = personLabels(summary.author);
  const mine = summary.authorId === me;
  const commentLabel = commentButtonLabel(state.page.commentCount);

  let actions: React.ReactNode;
  if (mine) {
    actions = (
      <>
        <Body variant="muted">This is your program.</Body>
        <Button
          label="Open in editor"
          variant="ghost"
          onPress={() => router.push({ pathname: '/program/[id]', params: { id: summary.id } })}
        />
      </>
    );
  } else if (!facts.hasWorkouts) {
    actions = <Body variant="muted">{NO_WORKOUTS}</Body>;
  } else if (done) {
    actions = done === 'saved' ? null : (
      <Button label="Go to the Workout tab" variant="ghost" onPress={() => router.push('/workout')} />
    );
  } else {
    actions = (
      <>
        {running ? <Body variant="small">{REPLACES_RUN}</Body> : null}
        <Button label="Save and Start" onPress={() => void copy(true)} disabled={busy || !db} />
        <Button label="Save to my programs" variant="ghost" onPress={() => void copy(false)} disabled={busy || !db} />
      </>
    );
  }

  return (
    <Screen>
      {backButton}
      <Heading>{payload.name}</Heading>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${author.name}'s profile`}
        onPress={() => router.push({ pathname: '/profile/[id]', params: { id: summary.authorId } })}
        style={styles.author}
      >
        <Body style={styles.authorName}>by {author.name}</Body>
      </Pressable>
      <Body variant="muted">{programFactsLine(facts)}</Body>

      {/* (B41) Votes and comments — only on a published program: the server takes votes and
          comments only there, so a program shared with followers or a team offers no doomed tap. */}
      {summary.visibility === 'published' ? (
        <View style={styles.social}>
          <VoteControl
            score={state.page.score}
            myVote={state.page.myVote}
            showDownvote
            scoreTestID="program-score"
            onVote={
              me
                ? (next) => (next == null ? clearProgramVote(client, me, summary.id) : castProgramVote(client, me, summary.id, next))
                : undefined
            }
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={commentLabel}
            onPress={() => router.push({ pathname: '/program-comments/[id]', params: { id: summary.id } })}
            style={styles.commentButton}
            hitSlop={8}
          >
            <Ionicons name="chatbubble-outline" size={18} color={colors.muted} />
            <Body variant="small">{commentLabel}</Body>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.actions}>
        {message ? <Body variant="small">{message}</Body> : null}
        {actions}
      </View>

      <View style={styles.breakdown}>
        <ProgramPayloadView payload={payload} unit={unit} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  author: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  authorName: {
    color: colors.accentText,
  },
  social: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  commentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  breakdown: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
});
