/**
 * ExercisePicker — the "Add exercise" sheet in the logger.
 *
 * What it shows: a full-screen panel over the workout with a search box, the exercise library
 * below it narrowed as the lifter types (the same alias-aware name search the Library tab uses,
 * so "back squat" finds Squat), and after the library matches the lifter's own custom exercises
 * (LIB-5) that match the same search, each marked "Custom".
 *
 * What the lifter can do: type to search, tap an exercise to add it to the workout (the panel
 * then closes), or tap Cancel / the system back button to close it without adding anything.
 *
 * It only reports the choice through `onPick` — as the exercise's id in the phone's database
 * (a library exercise's id is worked out from its catalog slug here; a custom's is its own id) —
 * and the logger screen adds it to the workout. Deleted customs never reach it: the screens pass
 * the live list from `useCustomExercises`.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { ExerciseRow } from '@/db/dao';
import { ALL_EXERCISES, searchExercises, type ExerciseDef } from '@/library/catalog';
import { filterCustomExercises } from '@/library/customExercises';
import { libraryExerciseId } from '@/library/uuidv5';
import { colors, layout, radii, spacing, type } from '@/theme';

/** What the picker reports: the picked exercise's database id and its name. */
export interface PickedExercise {
  /** The exercise's id in the phone's `exercises` table — what the workout store takes. */
  deviceId: string;
  name: string;
}

interface ExercisePickerProps {
  /** Whether the panel is open. */
  visible: boolean;
  /**
   * The lifter's live custom exercises (from `useCustomExercises`), listed after the library
   * matches. Required, so a logging screen can't forget to offer them.
   */
  customExercises: readonly ExerciseRow[];
  /** Called with the tapped exercise. */
  onPick: (exercise: PickedExercise) => void;
  /** Called when the lifter closes the panel without picking. */
  onClose: () => void;
}

/** One row of the list: a library exercise or one of the lifter's own. */
type PickerRow = { kind: 'library'; exercise: ExerciseDef } | { kind: 'custom'; exercise: ExerciseRow };

export function ExercisePicker({ visible, customExercises, onPick, onClose }: ExercisePickerProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const rows = useMemo<PickerRow[]>(
    () => [
      ...searchExercises(query, ALL_EXERCISES).map((exercise): PickerRow => ({ kind: 'library', exercise })),
      ...filterCustomExercises(customExercises, { query }).map((exercise): PickerRow => ({ kind: 'custom', exercise })),
    ],
    [query, customExercises],
  );

  /** Reports the pick (as the database id) and resets the search so the next open starts fresh. */
  function pick(row: PickerRow): void {
    setQuery('');
    onPick(
      row.kind === 'library'
        ? { deviceId: libraryExerciseId(row.exercise.id), name: row.exercise.name }
        : { deviceId: row.exercise.id, name: row.exercise.name },
    );
  }

  /** Closes without picking, also resetting the search. */
  function close(): void {
    setQuery('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} transparent={false}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.header}>
          <Heading size="section">Add exercise</Heading>
          <Button label="Cancel" variant="ghost" onPress={close} />
        </View>
        <TextInput
          style={styles.search}
          placeholder="Search exercises"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search exercises"
          autoCorrect={false}
        />
        <FlatList
          data={rows}
          keyExtractor={(row) => `${row.kind}:${row.exercise.id}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.exercise.name}`}
              onPress={() => pick(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Body style={styles.rowName}>{item.exercise.name}</Body>
              <SectionLabel size="small">
                {item.kind === 'library'
                  ? item.exercise.equipment
                  : item.exercise.equipment
                    ? `Custom · ${item.exercise.equipment}`
                    : 'Custom'}
              </SectionLabel>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState icon="barbell-outline" message="No exercises match that search. Try another name." />
          }
        />
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
  search: {
    ...type.body,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: layout.minTouchTarget,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  rowName: {
    flexShrink: 1,
  },
});
