/**
 * Library — the exercise library (LIB-1..LIB-7): every launch exercise as a
 * card, with name search and body-region filter chips. The cards render from
 * the imported founder library (LIB-7, `src/library/`): name, equipment,
 * primary muscles and movement pattern. Tapping into a card for demo video,
 * coaching steps and history arrives with LIB-2/3/4.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { ALL_EXERCISES, searchExercises, type ExerciseDef } from '@/library/catalog';
import { colors, radii, spacing, type } from '@/theme';

/** The four filter categories and their identity colors (styling guide §1). */
const CATEGORIES = [
  { key: 'upper', label: 'Upper', color: colors.category.upper, dim: colors.category.upperDim },
  { key: 'lower', label: 'Lower', color: colors.category.lower, dim: colors.category.lowerDim },
  { key: 'core', label: 'Core', color: colors.category.core, dim: colors.category.coreDim },
  { key: 'cardio', label: 'Cardio', color: colors.category.cardio, dim: colors.category.cardioDim },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]['key'];

/** One library card: exercise name, equipment pill, muscles and pattern. */
function ExerciseCard({ exercise }: { exercise: ExerciseDef }) {
  const regionColor = colors.category[exercise.body];
  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <View style={[styles.regionDot, { backgroundColor: regionColor }]} />
          <Body style={styles.cardName}>{exercise.name}</Body>
        </View>
        <View style={styles.equipmentPill}>
          <SectionLabel size="small">{exercise.equipment}</SectionLabel>
        </View>
      </View>
      <Body variant="small" style={styles.cardMeta}>
        {exercise.primary} · {exercise.patterns[0]}
      </Body>
    </Card>
  );
}

export default function LibraryScreen() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CategoryKey | null>(null);

  const results = useMemo(() => {
    const byRegion = selected
      ? ALL_EXERCISES.filter((exercise) => exercise.body === selected)
      : ALL_EXERCISES;
    return searchExercises(query, byRegion);
  }, [query, selected]);

  const header = (
    <View>
      <Heading>Library</Heading>
      <Body variant="muted" style={styles.lede}>
        Every movement, with demos, cues and your history.
      </Body>

      <View style={styles.search}>
        {/* Decorative — the input carries the accessible label. */}
        <Ionicons
          name="search"
          size={16}
          color={colors.muted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search exercises"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search exercises"
        />
      </View>

      <View style={styles.chips}>
        {CATEGORIES.map((category) => {
          const active = selected === category.key;
          return (
            <Pressable
              key={category.key}
              style={({ pressed }) => [
                styles.chip,
                active && { backgroundColor: category.dim, borderColor: category.color },
                pressed && styles.chipPressed,
              ]}
              onPress={() => setSelected(active ? null : category.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter: ${category.label}`}
            >
              <View style={[styles.chipDot, { backgroundColor: category.color }]} />
              <SectionLabel size="small" style={active ? { color: colors.text } : undefined}>
                {category.label}
              </SectionLabel>
            </Pressable>
          );
        })}
      </View>

      <SectionLabel size="small" style={styles.count}>
        {results.length === 1 ? '1 exercise' : `${results.length} exercises`}
      </SectionLabel>
    </View>
  );

  return (
    // The list owns the bottom inset (listContent), so zero Screen's — the two
    // would otherwise stack and clip scrolling cards above the screen edge.
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <FlatList
        data={results}
        keyExtractor={(exercise) => exercise.id}
        renderItem={({ item }) => <ExerciseCard exercise={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="barbell-outline"
            message="No exercises match that search. Try another name, or clear the filter."
          />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.sm,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xl,
    minHeight: 44,
  },
  searchInput: {
    ...type.body,
    flex: 1,
    paddingVertical: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 36,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: radii.round,
  },
  count: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  screenContent: {
    paddingBottom: 0,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  card: {
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  regionDot: {
    width: 8,
    height: 8,
    borderRadius: radii.round,
  },
  cardName: {
    flexShrink: 1,
  },
  equipmentPill: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  cardMeta: {
    marginTop: spacing.xs,
  },
});
