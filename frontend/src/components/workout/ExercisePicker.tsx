/**
 * ExercisePicker — the "Add exercise" sheet in the logger.
 *
 * What it shows: a full-screen panel over the workout with a search box and the exercise
 * library below it, narrowed as the lifter types (the same alias-aware name search the Library
 * tab uses, so "back squat" finds Squat).
 *
 * What the lifter can do: type to search, tap an exercise to add it to the workout (the panel
 * then closes), or tap Cancel / the system back button to close it without adding anything.
 *
 * It only reports the choice through `onPick`; the logger screen adds the exercise to the store.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { ALL_EXERCISES, searchExercises, type ExerciseDef } from '@/library/catalog';
import { colors, layout, radii, spacing, type } from '@/theme';

interface ExercisePickerProps {
  /** Whether the panel is open. */
  visible: boolean;
  /** Called with the tapped exercise. */
  onPick: (exercise: ExerciseDef) => void;
  /** Called when the lifter closes the panel without picking. */
  onClose: () => void;
}

export function ExercisePicker({ visible, onPick, onClose }: ExercisePickerProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchExercises(query, ALL_EXERCISES), [query]);

  /** Reports the pick and resets the search so the next open starts fresh. */
  function pick(exercise: ExerciseDef): void {
    setQuery('');
    onPick(exercise);
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
          data={results}
          keyExtractor={(exercise) => exercise.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name}`}
              onPress={() => pick(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Body style={styles.rowName}>{item.name}</Body>
              <SectionLabel size="small">{item.equipment}</SectionLabel>
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
