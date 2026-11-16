/**
 * TimerScreen — the Tool Kit's timer (TK-5): a gym wall clock in the lifter's pocket.
 *
 * What it shows: a mode switcher — Stopwatch | Countdown | EMOM | AMRAP | Tabata — and the time,
 * huge, as the screen's main event. Above the time: what it means ("Time left", "Work") and, for
 * EMOM and Tabata, the round ("Round 3 of 8"). Below it, for AMRAP, the time left to the cap.
 * Before a timer starts, the chosen mode's set-up boxes: countdown has one-tap rest presets
 * (0:30 … 5:00) plus minutes/seconds boxes; EMOM an interval and rounds; AMRAP a time cap; Tabata
 * work seconds, rest seconds and rounds. When a finite timer ends: "Time's up" (worded per mode).
 *
 * What the lifter can do: pick a mode and set it up, then Start, Pause, Resume and Reset — and
 * "Go again" once it has finished. The mode chips are locked while a timer is running or paused:
 * Reset is the deliberate way out, so a mis-tap can never kill a clock mid-workout.
 *
 * How it keeps time: it doesn't — the timer store does (`toolkit/timerStore.ts`, math in
 * `toolkit/timer.ts`), from timestamps. This screen only redraws about four times a second while
 * a timer runs, and only while it is on screen; each redraw reads the right time afresh. So the
 * lifter can close the Tool Kit, lock the phone or switch apps, and the time is right when they
 * come back. The phone shows a "time's up" notification at zero even if Astra is in the
 * background (if notifications are off, a line here says so — the timer itself works the same).
 *
 * Screen readers hear each new round and each work/rest switch announced, and "Time's up" at the
 * end, so nobody has to watch the clock.
 *
 * Works with no signal — nothing here leaves the phone.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormError } from '@/components/ui/FormError';
import { Body, SectionLabel } from '@/components/ui/Text';
import { readMinSec } from '@/toolkit/inputs';
import {
  defaultTimerDrafts,
  formatClock,
  readTimerConfig,
  snapshot,
  zeroAlertText,
  type TimerDrafts,
  type TimerMode,
  type TimerSnapshot,
} from '@/toolkit/timer';
import { timerStore, type TimerStoreState } from '@/toolkit/timerStore';
import { colors, fontScaleCaps, spacing, type } from '@/theme';

import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { NumberField } from './WeightField';

/** The mode switcher's chips, in order. */
const MODE_OPTIONS: readonly ChoiceOption<TimerMode>[] = [
  { value: 'stopwatch', label: 'Stopwatch', spoken: 'Stopwatch' },
  { value: 'countdown', label: 'Countdown', spoken: 'Countdown' },
  { value: 'emom', label: 'EMOM', spoken: 'EMOM, every minute on the minute' },
  { value: 'amrap', label: 'AMRAP', spoken: 'AMRAP, as many rounds as possible' },
  { value: 'tabata', label: 'Tabata', spoken: 'Tabata' },
];

/** One-tap countdown lengths for common rests between sets, in seconds. */
const REST_PRESETS_SECONDS = [30, 60, 90, 120, 180, 300];
const PRESET_OPTIONS: readonly ChoiceOption<number>[] = REST_PRESETS_SECONDS.map((seconds) => ({
  value: seconds,
  label: formatClock(seconds),
  spoken: `${formatClock(seconds)} rest`,
}));

/** How often the time is redrawn while a timer runs. A display choice only — it keeps no time. */
const REDRAW_MS = 250;

/** Shown in place of the time while the set-up boxes can't make a timer (one is wrong or empty). */
const NO_TIME = '–:––';

export function TimerScreen() {
  const state = useSyncExternalStore(timerStore.subscribe, timerStore.getState);
  const { drafts, run, alertsOff } = state;
  // The clock reading this frame is drawn at; moved on by the redraw interval and every button.
  const [now, setNow] = useState(() => Date.now());
  const reading = readTimerConfig(drafts);
  const frame = idleOrRunningFrame(drafts, reading, run, now);
  const mode = run?.config.mode ?? drafts.mode;
  const config = run?.config ?? (reading.ok ? reading.config : null);
  const endWords = config ? zeroAlertText(config) : null;

  // Redraw about four times a second, only while a timer is running and this screen is showing.
  useEffect(() => {
    if (frame.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => clearInterval(id);
  }, [frame.status]);

  useAnnouncements(frame, endWords);

  /** Runs a timer action, then redraws at once (not on the next interval tick). */
  const act = (action: () => void) => () => {
    action();
    setNow(Date.now());
  };

  return (
    <View style={styles.root}>
      <ChoiceChips
        options={MODE_OPTIONS}
        selected={mode}
        onSelect={(value) => timerStore.setMode(value)}
        disabled={run !== null}
      />

      <Card accent style={styles.clockCard}>
        <View accessible accessibilityLabel={clockLabel(frame)} style={styles.clock}>
          <SectionLabel>{caption(frame)}</SectionLabel>
          <Text
            style={styles.digits}
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={fontScaleCaps.timer}
          >
            {frame.display}
          </Text>
          {mode === 'amrap' && frame.remainingMs !== null ? (
            <Body variant="muted">{formatClock(Math.ceil(frame.remainingMs / 1000))} left of the cap</Body>
          ) : null}
          {frame.status === 'done' && endWords ? (
            <>
              <Body style={styles.doneText}>{endWords.title}</Body>
              <Body variant="muted">{endWords.body}</Body>
            </>
          ) : null}
          {frame.status === 'paused' ? <Body variant="muted">Paused</Body> : null}
        </View>
      </Card>

      <View style={styles.controls}>
        {frame.status === 'idle' ? (
          <Button label="Start" onPress={act(() => timerStore.start())} disabled={!reading.ok} />
        ) : null}
        {frame.status === 'running' ? (
          <Button label="Pause" onPress={act(() => timerStore.pause())} />
        ) : null}
        {frame.status === 'paused' ? (
          <Button label="Resume" onPress={act(() => timerStore.resume())} />
        ) : null}
        {frame.status === 'done' ? (
          <Button
            label="Go again"
            onPress={act(() => {
              timerStore.reset();
              timerStore.start();
            })}
          />
        ) : null}
        {frame.status !== 'idle' ? (
          <Button label="Reset" variant="ghost" onPress={act(() => timerStore.reset())} />
        ) : null}
      </View>

      {frame.status === 'idle' ? <SetUp drafts={drafts} /> : null}

      {alertsOff ? (
        <Body variant="small" style={styles.note}>
          Notifications are off, so there’s no alert at zero when Astra is in the background — the timer
          still keeps time here.
        </Body>
      ) : null}
    </View>
  );
}

/** The small line above the digits: what they mean, plus the round for EMOM and Tabata. */
function caption(frame: TimerSnapshot): string {
  if (frame.round === null || frame.rounds === null) return frame.displayMeaning;
  return `Round ${frame.round} of ${frame.rounds} · ${frame.displayMeaning}`;
}

/** What a screen reader hears for the clock: the caption and the time, as one phrase. */
function clockLabel(frame: TimerSnapshot): string {
  return `${caption(frame)}: ${frame.display}`;
}

/**
 * The frame to draw. A started timer is drawn from its run. Before starting, it previews the set-up;
 * if a box is wrong, it previews the chosen mode's default set-up (so the caption still names the
 * right mode) with the time shown as "–:––" rather than a number that won't happen.
 */
function idleOrRunningFrame(
  drafts: TimerDrafts,
  reading: ReturnType<typeof readTimerConfig>,
  run: TimerStoreState['run'],
  now: number,
): TimerSnapshot {
  if (run !== null || reading.ok) return snapshot(run, now, reading.ok ? reading.config : undefined);
  const fallback = readTimerConfig({ ...defaultTimerDrafts(), mode: drafts.mode });
  const preview = snapshot(null, now, fallback.ok ? fallback.config : undefined);
  return { ...preview, display: NO_TIME, remainingMs: null };
}

/**
 * Announces timer changes to screen readers (NFR-10): the round (and, for Tabata, work or rest)
 * when a timer starts and every time it changes, then the end. Pausing and resuming don't repeat
 * the current round, and re-opening the panel on a running timer announces nothing.
 */
function useAnnouncements(frame: TimerSnapshot, endWords: { title: string; body: string } | null): void {
  const key =
    frame.status === 'done' ? 'done' : frame.status === 'running' ? `${frame.round ?? ''}:${frame.phase ?? ''}` : null;
  // What was last announced (or already showing when the screen opened); null once back at set-up.
  const last = useRef<string | null>(key);
  const { round, rounds, phase, displayMeaning, status } = frame;
  useEffect(() => {
    if (status === 'idle') {
      last.current = null;
      return;
    }
    if (key === null || key === last.current) return; // paused, or nothing new
    last.current = key;
    if (key === 'done') {
      if (endWords) AccessibilityInfo.announceForAccessibility(`${endWords.title}. ${endWords.body}`);
    } else if (round !== null) {
      // "Round 2 of 10" for EMOM; "Round 3 of 8 · Rest" for Tabata.
      const roundWords = `Round ${round} of ${rounds}`;
      AccessibilityInfo.announceForAccessibility(phase ? `${roundWords} · ${displayMeaning}` : roundWords);
    }
  }, [key, status, round, rounds, phase, displayMeaning, endWords]);
}

/** The chosen mode's set-up boxes. Every keystroke is remembered by the timer store. */
function SetUp({ drafts }: { drafts: TimerDrafts }) {
  const reading = readTimerConfig(drafts);
  const errors = reading.ok ? {} : reading.errors;

  switch (drafts.mode) {
    case 'stopwatch':
      return (
        <Body variant="muted" style={styles.note}>
          Counts up from 0:00 until you stop it.
        </Body>
      );
    case 'countdown':
    case 'amrap': {
      const which = drafts.mode;
      const boxes = drafts[which];
      // The preset chip lit is the one matching the boxes, if any (-1 lights none).
      const typed = readMinSec(boxes.minutes, boxes.seconds);
      const presetSeconds = typed.kind === 'ok' ? typed.value / 1000 : -1;
      return (
        <View style={styles.setup}>
          {which === 'countdown' ? (
            <View style={styles.group}>
              <SectionLabel size="small">Rest</SectionLabel>
              <ChoiceChips
                options={PRESET_OPTIONS}
                selected={presetSeconds}
                onSelect={(seconds) =>
                  timerStore.updateDraft('countdown', {
                    minutes: String(Math.floor(seconds / 60)),
                    seconds: String(seconds % 60),
                  })
                }
              />
            </View>
          ) : null}
          <MinSecFields
            label={which === 'countdown' ? 'Countdown' : 'Time cap'}
            minutes={boxes.minutes}
            seconds={boxes.seconds}
            error={errors.time ?? null}
            onChange={(values) => timerStore.updateDraft(which, values)}
          />
        </View>
      );
    }
    case 'emom':
      return (
        <View style={styles.setup}>
          <MinSecFields
            label="Every"
            minutes={drafts.emom.minutes}
            seconds={drafts.emom.seconds}
            error={errors.time ?? null}
            onChange={(values) => timerStore.updateDraft('emom', values)}
          />
          <NumberField
            label="Rounds"
            value={drafts.emom.rounds}
            onChangeText={(rounds) => timerStore.updateDraft('emom', { rounds })}
            error={errors.rounds ?? null}
          />
        </View>
      );
    case 'tabata':
      return (
        <View style={styles.setup}>
          <View style={styles.pair}>
            <View style={styles.pairItem}>
              <NumberField
                label="Work (s)"
                value={drafts.tabata.workSeconds}
                onChangeText={(workSeconds) => timerStore.updateDraft('tabata', { workSeconds })}
                error={errors.work ?? null}
              />
            </View>
            <View style={styles.pairItem}>
              <NumberField
                label="Rest (s)"
                value={drafts.tabata.restSeconds}
                onChangeText={(restSeconds) => timerStore.updateDraft('tabata', { restSeconds })}
                error={errors.rest ?? null}
              />
            </View>
          </View>
          <NumberField
            label="Rounds"
            value={drafts.tabata.rounds}
            onChangeText={(rounds) => timerStore.updateDraft('tabata', { rounds })}
            error={errors.rounds ?? null}
          />
        </View>
      );
  }
}

interface MinSecFieldsProps {
  /** What the time is ("Countdown", "Every", "Time cap"); each box's label adds "minutes"/"seconds". */
  label: string;
  minutes: string;
  seconds: string;
  error: string | null;
  onChange: (values: { minutes?: string; seconds?: string }) => void;
}

/** A time typed as a minutes box beside a seconds box, with one problem line under both. */
function MinSecFields({ label, minutes, seconds, error, onChange }: MinSecFieldsProps) {
  return (
    <View style={styles.group}>
      <View style={styles.pair}>
        <View style={styles.pairItem}>
          <NumberField label={`${label} minutes`} value={minutes} onChangeText={(text) => onChange({ minutes: text })} error={null} />
        </View>
        <View style={styles.pairItem}>
          <NumberField label={`${label} seconds`} value={seconds} onChangeText={(text) => onChange({ seconds: text })} error={null} />
        </View>
      </View>
      <FormError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  clockCard: {
    paddingVertical: spacing.xl,
  },
  clock: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  digits: {
    ...type.timer,
    fontVariant: ['tabular-nums'],
  },
  doneText: {
    color: colors.text,
  },
  controls: {
    gap: spacing.md,
  },
  setup: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
  },
  pair: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  pairItem: {
    flex: 1,
  },
  note: {
    color: colors.muted,
  },
});
