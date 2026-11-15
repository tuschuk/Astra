/**
 * EntryCard — one exercise in the workout being logged.
 *
 * What it shows: the exercise's name, a "Last time" line with the sets from the previous
 * session of this exercise (LOG-5; absent if it has never been logged), and every set logged
 * so far in this workout ("Set 2 · 8 × 185 lb").
 *
 * What the lifter can do:
 *   - type reps and/or weight (in their unit) and tap **Log set** (LOG-2);
 *   - tap **Repeat** to log an exact copy of the last set — one tap, nothing to type or confirm
 *     (NFR-2). It is shown but disabled until the first set exists, so it is easy to discover;
 *   - remove any set, remove the whole exercise, or move it up / down in the workout.
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
import type { WeightUnit } from '@training-math';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { Body, SectionLabel } from '@/components/ui/Text';
import type { SqlExecutor } from '@/db/driver';
import type { ActiveEntry, ActiveWorkoutStore } from '@/workout/activeWorkout';
import { formatLastTime, formatSet, parseNumberInput, setErrorMessage } from '@/workout/format';
import { exerciseName, lastSessionSets, type LastSession } from '@/workout/history';
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
}

/** What the card looks up once, when it first appears. */
interface EntryHistory {
  name: string | null;
  lastTime: LastSession | null;
}

/**
 * Looks up the exercise's name and its previous session once, when the card appears. The
 * previous session is finished history, so it cannot change during this workout — there is
 * nothing to refresh later.
 */
function useEntryHistory(db: SqlExecutor, userId: string, exerciseId: string | null, workoutId: string): EntryHistory {
  const [history, setHistory] = useState<EntryHistory>({ name: null, lastTime: null });
  useEffect(() => {
    if (!exerciseId) return;
    let cancelled = false;
    Promise.all([exerciseName(db, userId, exerciseId), lastSessionSets(db, userId, exerciseId, workoutId)])
      .then(([name, lastTime]) => {
        if (!cancelled) setHistory({ name, lastTime });
      })
      .catch((error: unknown) => console.warn('Could not read this exercise’s history', error));
    return () => {
      cancelled = true;
    };
  }, [db, userId, exerciseId, workoutId]);
  return history;
}

export function EntryCard({ store, entry, entryCount, db, userId, unit }: EntryCardProps) {
  const { name, lastTime } = useEntryHistory(db, userId, entry.exercise_id, entry.workout_id);
  const label = name ?? 'Exercise';
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
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

  /** Reads the two boxes and logs the set (the typed values stay, ready for the next set). */
  function logSet(): void {
    const parsedReps = parseNumberInput(reps);
    const parsedWeight = parseNumberInput(weight);
    if (!parsedReps.ok || !parsedWeight.ok) {
      setError('Enter reps and weight as plain numbers.');
      return;
    }
    const weightValue = parsedWeight.value;
    void run(() =>
      store.logSet(entry.id, {
        reps: parsedReps.value,
        weight: weightValue == null ? null : { value: weightValue, unit },
      }),
    );
  }

  const canLog = reps.trim() !== '' || weight.trim() !== '';
  const hasSets = entry.sets.length > 0;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Body style={styles.name}>{label}</Body>
        <View style={styles.headerActions}>
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

      {lastTime && lastTime.sets.length > 0 ? (
        <Body variant="small" style={styles.lastTime}>
          Last time: {formatLastTime(lastTime.sets, unit)}
        </Body>
      ) : null}

      {entry.sets.map((set) => (
        <View key={set.id} style={styles.setRow}>
          <SectionLabel size="small" style={styles.setNumber}>
            Set {set.position + 1}
          </SectionLabel>
          <Body style={styles.setText}>{formatSet(set, unit)}</Body>
          <IconButton
            icon="close"
            label={`Remove set ${set.position + 1} of ${label}`}
            disabled={pending}
            onPress={() => void run(() => store.removeSet(set.id))}
          />
        </View>
      ))}

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
          placeholder={unit}
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          accessibilityLabel={`Weight in ${unit} for ${label}`}
        />
        <Button label="Log set" onPress={logSet} disabled={pending || !canLog} style={styles.logButton} />
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
