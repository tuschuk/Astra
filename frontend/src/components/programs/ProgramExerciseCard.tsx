/**
 * ProgramExerciseCard — one exercise slot in a program workout's editor (PRG-1, B34).
 *
 * What it shows: the exercise's name ("Deleted exercise" if it no longer exists), its current
 * targets as one line ("3 × 8 @ 135 lb · RPE 8", weight in the lifter's unit), and four boxes to
 * change them — Sets (required), Reps, Weight (in the lifter's kg/lb unit) and RPE (all three
 * optional; leave one empty for "no target").
 *
 * What the lifter can do: edit the boxes and tap **Save targets** (the phone saves at once, no
 * signal needed); move the exercise **up** or **down** within the workout; **Remove** it (the
 * screen asks first). A target the server would refuse (0 sets, half a rep, RPE 11, a weight too
 * big to store) is turned away with a message on the card, never saved.
 */
import React, { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { displayWeight, type WeightUnit } from '@training-math';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormError } from '@/components/ui/FormError';
import { Body, SectionLabel } from '@/components/ui/Text';
import { formatProgramTargets, type ProgramExerciseNode, type ProgramTargetsInput } from '@/programs/programs';
import { parseNumberInput } from '@/workout/format';
import { colors, layout, radii, spacing, type } from '@/theme';

interface ProgramExerciseCardProps {
  /** The slot and its exercise's name, as the tree read gives them. */
  node: ProgramExerciseNode;
  /** 0-based place in the workout and how many slots there are (to disable impossible moves). */
  index: number;
  count: number;
  /** The unit weights are shown and typed in. */
  unit: WeightUnit;
  /** Saves new targets; throws a `RangeError` for a value the server would refuse. */
  onSaveTargets: (targets: ProgramTargetsInput) => Promise<void>;
  onMove: (direction: 'up' | 'down') => Promise<void>;
  /** Asks, then removes the slot. */
  onRemove: () => void;
}

/** A number as box text, or empty for none. */
function boxText(value: number | null): string {
  return value == null ? '' : String(value);
}

/** Turns a refused target into a sentence for the lifter. */
export function targetsErrorMessage(error: unknown): string {
  if (error instanceof RangeError) {
    if (error.message.startsWith('targetSets')) return 'Sets must be a whole number, at least 1.';
    if (error.message.startsWith('targetReps')) return 'Reps must be a whole number.';
    if (error.message.startsWith('targetWeightKg')) return 'That weight is too big to save.';
    if (error.message.startsWith('targetRpe')) return 'RPE goes from 1 to 10.';
    return 'Those targets have a value Astra can’t save.';
  }
  return 'Those targets couldn’t be saved. Try again.';
}

export function ProgramExerciseCard({ node, index, count, unit, onSaveTargets, onMove, onRemove }: ProgramExerciseCardProps) {
  const { slot, exerciseName } = node;
  const [sets, setSets] = useState(String(slot.target_sets));
  const [reps, setReps] = useState(boxText(slot.target_reps));
  // The box shows the stored kg rounded for display. If the lifter leaves it as shown, the stored
  // kg is saved back as it was — never the rounded display number, which would quietly move a
  // weight they didn't touch (100 kg shows as 220.5 lb, and 220.5 lb is 100.02 kg).
  const shownWeight = slot.target_weight_kg == null ? '' : String(displayWeight(slot.target_weight_kg, unit));
  const [weight, setWeight] = useState(shownWeight);
  const [rpe, setRpe] = useState(boxText(slot.target_rpe));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Closes the double-tap gap before React redraws the disabled buttons.
  const running = useRef(false);

  /** Runs one action at a time, turning a refusal into the card's message. */
  async function run(action: () => Promise<void>): Promise<void> {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(targetsErrorMessage(caught));
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  /** Reads the four boxes and saves them, or explains which box can't be read. */
  function save(): void {
    const parsed = [sets, reps, weight, rpe].map(parseNumberInput);
    if (parsed.some((p) => !p.ok)) {
      setError('Enter sets, reps, weight and RPE as plain numbers.');
      return;
    }
    const [s, r, w, e] = parsed.map((p) => (p.ok ? p.value : null));
    if (s == null) {
      setError('Every exercise needs a number of sets.');
      return;
    }
    const stored = slot.target_weight_kg;
    const target =
      stored != null && weight.trim() === shownWeight
        ? { value: stored, unit: 'kg' as const }
        : w == null
          ? null
          : { value: w, unit };
    void run(() => onSaveTargets({ sets: s, reps: r, weight: target, rpe: e }));
  }

  const boxes: { label: string; value: string; set: (text: string) => void }[] = [
    { label: 'Sets', value: sets, set: setSets },
    { label: 'Reps', value: reps, set: setReps },
    { label: unit, value: weight, set: setWeight },
    { label: 'RPE', value: rpe, set: setRpe },
  ];

  return (
    <Card style={styles.card}>
      <Body style={styles.name}>{exerciseName}</Body>
      <SectionLabel size="small">{formatProgramTargets(slot, unit)}</SectionLabel>

      <View style={styles.boxes}>
        {boxes.map((box) => (
          <View key={box.label} style={styles.box}>
            <SectionLabel size="small">{box.label}</SectionLabel>
            <TextInput
              style={styles.input}
              value={box.value}
              onChangeText={box.set}
              keyboardType="decimal-pad"
              accessibilityLabel={`${box.label === unit ? `Weight in ${unit}` : box.label} for ${exerciseName}`}
              placeholderTextColor={colors.muted}
              selectionColor={colors.accent}
            />
          </View>
        ))}
      </View>

      {error ? <FormError message={error} /> : null}

      <View style={styles.actions}>
        <Button
          label="Save targets"
          variant="outline"
          onPress={save}
          disabled={pending}
          accessibilityLabel={`Save targets for ${exerciseName}`}
        />
        <Button
          label="Up"
          variant="ghost"
          onPress={() => void run(() => onMove('up'))}
          disabled={pending || index === 0}
          accessibilityLabel={`Move ${exerciseName} up`}
        />
        <Button
          label="Down"
          variant="ghost"
          onPress={() => void run(() => onMove('down'))}
          disabled={pending || index === count - 1}
          accessibilityLabel={`Move ${exerciseName} down`}
        />
        <Button
          label="Remove"
          variant="ghost"
          onPress={onRemove}
          disabled={pending}
          accessibilityLabel={`Remove ${exerciseName}`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  name: {
    ...type.cardTitle,
  },
  boxes: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  box: {
    flex: 1,
    gap: spacing.xs,
  },
  input: {
    ...type.input,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBg,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
