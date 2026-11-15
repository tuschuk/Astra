/**
 * CustomExerciseForm — the "New exercise" / "Edit exercise" panel for a lifter's own custom
 * exercise (LIB-5, B31).
 *
 * What it shows: a full-screen panel with a Name box, a row of equipment chips (Barbell,
 * Dumbbell, Bodyweight, Cable, Machine, Cardio Machine) and a row of main-muscle chips (the twelve
 * muscle groups) — the same words the Library's filters use, so the new exercise can be found by
 * them. Both chip rows are optional. Opened from the Library tab (create) or the custom exercise's
 * card (edit, with the current values filled in).
 *
 * What the lifter can do: type a name (Save stays disabled until there is one, and a name longer
 * than the server's 80-character limit is refused with a message); tap a chip to choose it and tap
 * it again to clear it; Save, which writes the exercise to the phone at once (no signal needed —
 * it uploads with the next sync) and closes the panel; or Cancel to throw the changes away.
 */
import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { assertValidExerciseName, MAX_EXERCISE_NAME_LENGTH } from '@training-math';

import { Button } from '@/components/ui/Button';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { FormError } from '@/components/ui/FormError';
import { Heading, SectionLabel } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import type { ExerciseRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { asEquipment, EQUIPMENT_ORDER } from '@/library/catalog';
import { createCustomExercise, updateCustomExercise } from '@/library/customExercises';
import type { Equipment, MuscleKey } from '@/library/exercises';
import { asMuscleKey, MUSCLE_NAMES, MUSCLE_ORDER } from '@/library/muscles';
import { colors, layout, spacing } from '@/theme';

const EQUIPMENT_OPTIONS: readonly ChoiceOption<Equipment>[] = EQUIPMENT_ORDER.map((kind) => ({
  value: kind,
  label: kind,
  spoken: `Equipment: ${kind}`,
}));

const MUSCLE_OPTIONS: readonly ChoiceOption<MuscleKey>[] = MUSCLE_ORDER.map((key) => ({
  value: key,
  label: MUSCLE_NAMES[key],
  spoken: `Main muscle: ${MUSCLE_NAMES[key]}`,
}));

/**
 * True when the (trimmed) name breaks the server's length rule. Asks the shared check in
 * `@training-math` rather than counting here, so the form and the save path can never disagree
 * about what "80 characters" means. An empty name is not reported — Save is simply disabled.
 */
function nameTooLong(trimmed: string): boolean {
  if (trimmed.length === 0) return false;
  try {
    assertValidExerciseName(trimmed);
    return false;
  } catch {
    return true;
  }
}

export interface CustomExerciseFormProps {
  /** Whether the panel is open. */
  visible: boolean;
  /** The phone's database (null while it opens — Save then waits). */
  db: SqlDriver | null;
  /** The signed-in lifter, who will own the exercise. */
  userId: string | null;
  /** The exercise being edited, or null to create a new one. */
  existing: ExerciseRow | null;
  /** Called with the saved row after a successful Save; the panel should then be closed. */
  onSaved: (row: ExerciseRow) => void;
  /** Called when the lifter cancels. */
  onClose: () => void;
}

/**
 * The form itself. It keeps its own draft of the three fields; the parent mounts it fresh (via a
 * `key`) each time it opens, so a cancelled draft never leaks into the next opening.
 */
export function CustomExerciseForm({ visible, db, userId, existing, onSaved, onClose }: CustomExerciseFormProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(existing?.name ?? '');
  const [equipment, setEquipment] = useState<Equipment | null>(asEquipment(existing?.equipment ?? null));
  const [muscle, setMuscle] = useState<MuscleKey | null>(asMuscleKey(existing?.primary_muscle ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const tooLong = nameTooLong(trimmed);
  const canSave = trimmed.length > 0 && !tooLong && !busy && db !== null && userId !== null;

  /** Saves (create or edit) through the custom-exercise module, then reports the saved row. */
  async function save(): Promise<void> {
    if (!canSave || !db || !userId) return;
    setBusy(true);
    setError(null);
    const input = { name, equipment, primaryMuscle: muscle };
    try {
      const row = existing
        ? await updateCustomExercise(db, userId, existing.id, input)
        : await createCustomExercise(db, userId, input);
      onSaved(row);
    } catch (caught) {
      console.warn('Custom exercise: could not save', caught);
      setError('That exercise couldn’t be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.header}>
          <Heading size="section">{existing ? 'Edit exercise' : 'New exercise'}</Heading>
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl, gap: spacing.lg }}
        >
          <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Landmine Press" />
          {tooLong ? <FormError message={`Names can be at most ${MAX_EXERCISE_NAME_LENGTH} characters.`} /> : null}

          <View style={styles.group}>
            <SectionLabel size="small">Equipment (optional)</SectionLabel>
            <ChoiceChips
              options={EQUIPMENT_OPTIONS}
              selected={equipment}
              onSelect={(kind) => setEquipment(kind === equipment ? null : kind)}
            />
          </View>

          <View style={styles.group}>
            <SectionLabel size="small">Main muscle (optional)</SectionLabel>
            <ChoiceChips
              options={MUSCLE_OPTIONS}
              selected={muscle}
              onSelect={(key) => setMuscle(key === muscle ? null : key)}
            />
          </View>

          {error ? <FormError message={error} /> : null}
          <Button label={existing ? 'Save changes' : 'Save exercise'} onPress={() => void save()} disabled={!canSave} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: layout.screenPadding,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  group: {
    gap: spacing.sm,
  },
});
