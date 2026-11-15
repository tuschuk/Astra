/**
 * EntryCard — one exercise in the workout being logged.
 *
 * What it shows: the exercise's name (with a "Superset" badge when it is part of one), a "Last
 * time" line with the work sets from the previous session of this exercise (LOG-5; warm-ups left
 * out, absent if it has never been logged), and every set logged so far in this workout
 * ("Set 2 · W · 8 × 135 lb", "Set 3 · 5 × 225 lb @ RPE 8", "Set 4 · 4:32"). Sets are numbered
 * the way the lifter counts them: a drop set is one "Set n" with its drops on "↳" rows under it.
 *
 * What the lifter can do:
 *   - type reps and/or weight (in their unit), optionally an RPE, and tap **Log set** (LOG-2,
 *     LOG-10). Reps alone is a complete set — that is how a pull-up is logged (LOG-15). For a
 *     bodyweight exercise the weight box asks for "+ lb": any weight typed is the *added* load
 *     (a weighted pull-up), which is what the PR books compare;
 *   - press **Warm-up** so the sets they log next are warm-ups (LOG-14 — never a PR, never
 *     volume). It stays pressed until they press it again, because warm-ups come in runs;
 *   - press **Timed** to open a **Time** box ("90" or "4:32") and a **Score** box ("7 rounds +
 *     12 reps") for timed or WOD-style work (LOG-13). Anything can be combined — reps with a
 *     time, a weight with a time, a score alone. Closing Timed empties both boxes;
 *   - tap **Drop** to log what the boxes say as the next drop of the latest set (LOG-12): log
 *     the top set, type the lighter weight, tap Drop, repeat;
 *   - tap the **link** icon (every card but the first) to superset this exercise with the one
 *     above it, or to undo that link (LOG-11);
 *   - tap the **W** beside any logged set to mark it as a warm-up or a work set after the fact
 *     (for a drop set, the whole drop set at once);
 *   - tap **Repeat** to log an exact copy of the last set — one tap, nothing to type or confirm
 *     (NFR-2). It is shown but disabled until the first set exists, so it is easy to discover;
 *   - remove any set (a drop set's "Set n" remove takes the whole drop set; each drop row has its
 *     own remove), remove the whole exercise, or move it up / down in the workout.
 *
 * Every action goes straight to the active-workout store, which saves to the phone's database
 * before anything changes on screen; the card redraws from the store's new snapshot. One action
 * runs at a time: the card's buttons are disabled until it is saved, so a double-tap does it
 * once. A set the
 * server would refuse (a 10-tonne weight, half a rep) is turned away with a message on the card,
 * never a crash.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MAX_SET_SCORE_LENGTH, type WeightUnit } from '@training-math';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { Body, SectionLabel } from '@/components/ui/Text';
import type { SqlExecutor } from '@/db/driver';
import type { SetRow } from '@/db/dao';
import type { Equipment } from '@/library/exercises';
import {
  nextDropPosition,
  setInputFromRow,
  type ActiveEntry,
  type ActiveWorkoutStore,
  type SetInput,
} from '@/workout/activeWorkout';
import {
  formatLastTime,
  formatSet,
  groupDropSets,
  parseDurationInput,
  parseNumberInput,
  setErrorMessage,
} from '@/workout/format';
import { exerciseInfo, lastSessionSets, type ExerciseInfo, type LastSession } from '@/workout/history';
import { colors, layout, radii, spacing, type } from '@/theme';

interface EntryCardProps {
  /** The active workout's store — every button here calls it. */
  store: ActiveWorkoutStore;
  /** This exercise, as the store's current snapshot holds it. */
  entry: ActiveEntry;
  /** How many exercises the workout has (to know whether "move down" makes sense). */
  entryCount: number;
  /** The phone's database, for the name and "last time" look-ups. */
  db: SqlExecutor;
  /** The signed-in lifter; look-ups only ever read their rows. */
  userId: string;
  /** The unit weights are shown and typed in. */
  unit: WeightUnit;
  /** True when this exercise is supersetted with the one just above it (the link toggle is on). */
  linkedToPrevious?: boolean;
  /** True when this exercise is part of any superset on screen (the card shows a badge). */
  inSuperset?: boolean;
}

/** What the card looks up once, when it first appears. */
interface EntryHistory {
  info: ExerciseInfo | null;
  lastTime: LastSession | null;
}

/** The library's equipment kind for movements done with the lifter's own body (see library/exercises.ts). */
const BODYWEIGHT_EQUIPMENT: Equipment = 'Bodyweight';

/**
 * Looks up the exercise's name, equipment and previous session once, when the card appears.
 * The previous session is finished history, so it cannot change during this workout — there is
 * nothing to refresh later.
 */
function useEntryHistory(db: SqlExecutor, userId: string, exerciseId: string | null, workoutId: string): EntryHistory {
  const [history, setHistory] = useState<EntryHistory>({ info: null, lastTime: null });
  useEffect(() => {
    if (!exerciseId) return;
    let cancelled = false;
    Promise.all([exerciseInfo(db, userId, exerciseId), lastSessionSets(db, userId, exerciseId, workoutId)])
      .then(([info, lastTime]) => {
        if (!cancelled) setHistory({ info, lastTime });
      })
      .catch((error: unknown) => console.warn('Could not read this exercise’s history', error));
    return () => {
      cancelled = true;
    };
  }, [db, userId, exerciseId, workoutId]);
  return history;
}

export function EntryCard({
  store,
  entry,
  entryCount,
  db,
  userId,
  unit,
  linkedToPrevious = false,
  inSuperset = false,
}: EntryCardProps) {
  const { info, lastTime } = useEntryHistory(db, userId, entry.exercise_id, entry.workout_id);
  const label = info?.name ?? 'Exercise';
  const bodyweight = info?.equipment === BODYWEIGHT_EQUIPMENT;
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [rpe, setRpe] = useState('');
  // The Timed disclosure (LOG-13): when open, a Time box and a Score box appear beside the
  // usual ones. Closing it empties both, so a hidden value can never ride into a logged set.
  const [timed, setTimed] = useState(false);
  const [time, setTime] = useState('');
  const [score, setScore] = useState('');
  // Whether the next set logged is a warm-up. Not reset after logging: warm-ups come in runs.
  const [warmup, setWarmup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // While a store call runs, the card's buttons are disabled and further taps are ignored, so
  // a double-tap on "move down" can't move the exercise twice (or Repeat log two copies). The
  // ref closes the gap before React has redrawn the disabled buttons.
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  /** Runs one store call at a time, turning a refusal into the card's message line. */
  async function run(action: () => Promise<unknown>): Promise<void> {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(setErrorMessage(caught));
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  /**
   * Reads every box (reps, weight, RPE, and time and score when Timed is open) and the Warm-up
   * chip into what the store saves, or shows a message and returns null if a box can't be read.
   * The store checks the ranges (whole reps, RPE 1–10, score length).
   */
  function readInput(): SetInput | null {
    const parsedReps = parseNumberInput(reps);
    const parsedWeight = parseNumberInput(weight);
    const parsedRpe = parseNumberInput(rpe);
    if (!parsedReps.ok || !parsedWeight.ok || !parsedRpe.ok) {
      setError('Enter reps, weight and RPE as plain numbers.');
      return null;
    }
    const parsedTime = parseDurationInput(time);
    if (!parsedTime.ok) {
      setError('Enter the time as seconds or m:ss, like 90 or 4:32.');
      return null;
    }
    const weightValue = parsedWeight.value;
    return {
      reps: parsedReps.value,
      weight: weightValue == null ? null : { value: weightValue, unit },
      rpe: parsedRpe.value,
      isWarmup: warmup,
      durationSeconds: parsedTime.value,
      // The store trims it and saves a blank score as none.
      score,
    };
  }

  /** Logs what the boxes say as a new set (the typed values stay, ready for the next set). */
  function logSet(): void {
    const input = readInput();
    if (input) void run(() => store.logSet(entry.id, input));
  }

  /**
   * Logs what the boxes say as the next drop of the latest set (LOG-12): the same values Log set
   * would save, plus the drop number. The lifter's flow is: log the top set, strip weight, type
   * the lighter weight, tap Drop — and again for each drop.
   */
  function logDrop(): void {
    const dropSetPosition = nextDropPosition(entry.sets);
    const input = readInput();
    if (input && dropSetPosition != null) void run(() => store.logSet(entry.id, { ...input, dropSetPosition }));
  }

  /**
   * Flips a logged set — every segment of it, for a drop set — between warm-up and work set,
   * keeping everything else it says. A drop set is all warm-up or all work, never half of each.
   */
  function toggleWarmup(segments: readonly SetRow[]): void {
    const isWarmup = !segments[0].is_warmup;
    void run(() =>
      store.updateSets(segments.map((set) => ({ setId: set.id, input: { ...setInputFromRow(set), isWarmup } }))),
    );
  }

  /** Opens or closes the Timed boxes; closing empties them. */
  function toggleTimed(): void {
    if (timed) {
      setTime('');
      setScore('');
    }
    setTimed(!timed);
  }

  // An RPE alone is not a set — something must have been lifted, held, timed or scored.
  const canLog = [reps, weight, time, score].some((box) => box.trim() !== '');
  const hasSets = entry.sets.length > 0;
  const logicalSets = groupDropSets(entry.sets);
  const lastTimeText = lastTime ? formatLastTime(lastTime.sets, unit) : '';
  const weightLabel = bodyweight ? `Added weight in ${unit} for ${label}` : `Weight in ${unit} for ${label}`;

  return (
    <Card style={styles.card}>
      {inSuperset ? (
        <SectionLabel size="small" style={styles.supersetBadge}>
          Superset
        </SectionLabel>
      ) : null}
      <View style={styles.header}>
        <Body style={styles.name}>{label}</Body>
        <View style={styles.headerActions}>
          {entry.position > 0 ? (
            <ToggleIcon
              icon="link"
              label={`Superset ${label} with the exercise above`}
              checked={linkedToPrevious}
              disabled={pending}
              onPress={() =>
                void run(() => (linkedToPrevious ? store.unlinkFromPrevious(entry.id) : store.linkWithPrevious(entry.id)))
              }
            />
          ) : null}
          <IconButton
            icon="chevron-up"
            label={`Move ${label} up`}
            disabled={pending || entry.position === 0}
            onPress={() => void run(() => store.reorderExercise(entry.id, entry.position - 1))}
          />
          <IconButton
            icon="chevron-down"
            label={`Move ${label} down`}
            disabled={pending || entry.position >= entryCount - 1}
            onPress={() => void run(() => store.reorderExercise(entry.id, entry.position + 1))}
          />
          <IconButton
            icon="trash-outline"
            label={`Remove ${label}`}
            disabled={pending}
            onPress={() => void run(() => store.removeExercise(entry.id))}
          />
        </View>
      </View>

      {lastTimeText !== '' ? (
        <Body variant="small" style={styles.lastTime}>
          Last time: {lastTimeText}
        </Body>
      ) : null}

      {/* Numbered by the sets the lifter thinks in: a drop set is one "Set n", its drops below it. */}
      {logicalSets.map((segments, index) => {
        const number = index + 1;
        const [top, ...drops] = segments;
        return (
          <View key={top.id}>
            <View style={styles.setRow}>
              <SectionLabel size="small" style={styles.setNumber}>
                Set {number}
              </SectionLabel>
              <Body style={styles.setText}>{formatSet(top, unit)}</Body>
              <ToggleIcon
                text="W"
                label={`Warm-up: set ${number} of ${label}`}
                checked={top.is_warmup}
                disabled={pending}
                onPress={() => toggleWarmup(segments)}
              />
              <IconButton
                icon="close"
                label={`Remove set ${number} of ${label}`}
                disabled={pending}
                // A drop set goes as a whole: a drop left without its top set would read as a
                // drop of the set before it.
                onPress={() => void run(() => store.removeSets(segments.map((s) => s.id)))}
              />
            </View>
            {drops.map((drop, dropIndex) => (
              <View key={drop.id} style={[styles.setRow, styles.dropRow]}>
                <Body style={[styles.setText, styles.dropText]}>↳ {formatSet({ ...drop, is_warmup: false }, unit)}</Body>
                <IconButton
                  icon="close"
                  label={`Remove drop ${dropIndex + 1} of set ${number} of ${label}`}
                  disabled={pending}
                  onPress={() => void run(() => store.removeSet(drop.id))}
                />
              </View>
            ))}
          </View>
        );
      })}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={reps}
          onChangeText={setReps}
          placeholder="Reps"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          accessibilityLabel={`Reps for ${label}`}
        />
        <TextInput
          style={styles.input}
          value={weight}
          onChangeText={setWeight}
          placeholder={bodyweight ? `+ ${unit}` : unit}
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          accessibilityLabel={weightLabel}
        />
        <TextInput
          style={styles.input}
          value={rpe}
          onChangeText={setRpe}
          placeholder="RPE"
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          accessibilityLabel={`RPE for ${label}`}
        />
      </View>

      {timed ? (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={time}
            onChangeText={setTime}
            placeholder="m:ss"
            placeholderTextColor={colors.muted}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel={`Time for ${label}`}
          />
          <TextInput
            style={[styles.input, styles.scoreInput]}
            value={score}
            onChangeText={setScore}
            placeholder="Score"
            placeholderTextColor={colors.muted}
            maxLength={MAX_SET_SCORE_LENGTH}
            accessibilityLabel={`Score for ${label}`}
          />
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <View style={styles.chips}>
          <Chip label="Warm-up" accessibilityLabel={`Warm-up sets for ${label}`} on={warmup} onPress={() => setWarmup((on) => !on)} />
          <Chip label="Timed" accessibilityLabel={`Timed work for ${label}`} on={timed} onPress={toggleTimed} />
        </View>
        <View style={styles.logButtons}>
          <Button
            label="Drop"
            variant="outline"
            onPress={logDrop}
            disabled={pending || !canLog || !hasSets}
          />
          <Button label="Log set" onPress={logSet} disabled={pending || !canLog} style={styles.logButton} />
        </View>
      </View>

      {/* NFR-2: one press, one saved copy of the last set. */}
      <Button
        label="Repeat last set"
        variant="ghost"
        disabled={pending || !hasSets}
        onPress={() => void run(() => store.repeatLastSet(entry.id))}
        style={styles.repeat}
      />

      <FormError message={error} style={styles.error} />
    </Card>
  );
}

/**
 * A small on/off control: filled when on, outlined when off. Two uses on the card:
 *   - the "W" beside a logged set (`text="W"`): on when the set is a warm-up. Tapping it flips
 *     the set between warm-up and work set (LOG-14), so a lifter who realizes at set 3 that
 *     sets 1–2 were warm-ups can fix them with one tap each;
 *   - the link icon in the header (`icon="link"`): on when the exercise is supersetted with
 *     the one above it (LOG-11); tapping it links or unlinks them.
 * Screen readers hear `label` and whether it is on.
 */
function ToggleIcon({
  label,
  checked,
  onPress,
  disabled,
  ...face
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  disabled: boolean;
} & ({ text: string } | { icon: keyof typeof Ionicons.glyphMap })) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={spacing.xs}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed, disabled && styles.iconDisabled]}
    >
      <View style={[styles.badge, checked && styles.chipOn]}>
        {'icon' in face ? (
          <Ionicons name={face.icon} size={16} color={checked ? colors.text : colors.muted} />
        ) : (
          <Body style={[styles.badgeText, checked && styles.chipTextOn]}>{face.text}</Body>
        )}
      </View>
    </Pressable>
  );
}

/**
 * A sticky option chip under the boxes (Warm-up, Timed): highlighted while on. Screen readers
 * hear it as a switch with `accessibilityLabel`.
 */
function Chip({
  label,
  accessibilityLabel,
  on,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.iconPressed]}
    >
      <Body style={[styles.chipText, on && styles.chipTextOn]}>{label}</Body>
    </Pressable>
  );
}

/** A small icon-only control with a spoken label (move, remove). */
function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={spacing.xs}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed, disabled && styles.iconDisabled]}
    >
      <Ionicons name={icon} size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: {
    ...type.cardTitle,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  lastTime: {
    color: colors.muted,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  setNumber: {
    width: 48,
  },
  setText: {
    flex: 1,
  },
  dropRow: {
    // Drops sit under their top set, indented past the "Set n" column.
    paddingLeft: 48 + spacing.md,
  },
  dropText: {
    color: colors.muted,
  },
  supersetBadge: {
    color: colors.accent,
  },
  scoreInput: {
    flex: 2,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexShrink: 1,
  },
  logButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  input: {
    ...type.input,
    flex: 1,
    minHeight: layout.minTouchTarget,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  chip: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
  },
  chipOn: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.muted,
  },
  chipTextOn: {
    color: colors.text,
  },
  badge: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
  },
  badgeText: {
    ...type.labelSmall,
  },
  logButton: {
    paddingHorizontal: spacing.lg,
  },
  repeat: {
    marginTop: spacing.xs,
  },
  error: {
    marginTop: spacing.xs,
  },
  iconButton: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  iconPressed: {
    backgroundColor: colors.surfaceHover,
  },
  iconDisabled: {
    // Matches Button's disabled look.
    opacity: 0.4,
  },
});
