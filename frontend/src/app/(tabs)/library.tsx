/**
 * Library — the exercise library (LIB-1, LIB-3, LIB-7): every launch exercise as a card.
 *
 * What it shows: a name search box, then three rows of filter chips — body region (Upper / Lower
 * / Core / Cardio), the twelve muscle groups, and the six kinds of equipment — then the matching
 * exercises as cards (name, equipment, main muscles, movement pattern) with a live count. The
 * cards come from the founder's imported library bundled with the app (`src/library/`), so the
 * tab works with no signal.
 *
 * What the user can do: type to search by name; tap a chip to filter by it and tap it again to
 * clear it (one chip per row at a time; the rows combine — e.g. Upper + Chest + Dumbbell). With a
 * muscle chosen, the exercises that train it hardest are listed first. Tapping a card opens that
 * exercise's detail screen (coaching steps, tips, muscles worked). Demo videos (LIB-2) and the
 * lifter's own history on the card (LIB-4) arrive in later steps.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import {
  ALL_EXERCISES,
  BODY_REGION_LABELS,
  EQUIPMENT_ORDER,
  filterExercises,
  searchExercises,
  type ExerciseDef,
} from '@/library/catalog';
import type { Equipment, MuscleKey } from '@/library/exercises';
import { MUSCLE_NAMES, MUSCLE_ORDER } from '@/library/muscles';
import { colors, radii, spacing, type } from '@/theme';

/** The four filter categories and their identity colors (styling guide §1). */
const CATEGORIES = [
  { key: 'upper', label: BODY_REGION_LABELS.upper, color: colors.category.upper, dim: colors.category.upperDim },
  { key: 'lower', label: BODY_REGION_LABELS.lower, color: colors.category.lower, dim: colors.category.lowerDim },
  { key: 'core', label: BODY_REGION_LABELS.core, color: colors.category.core, dim: colors.category.coreDim },
  { key: 'cardio', label: BODY_REGION_LABELS.cardio, color: colors.category.cardio, dim: colors.category.cardioDim },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]['key'];

/**
 * One filter chip — the same look and screen-reader surface as the region chips: a bordered pill
 * that fills when active and is announced as "Filter: <label>", selected or not. Tapping calls
 * `onPress`; the screen decides whether that selects or clears.
 */
function FilterChip({
  label,
  active,
  onPress,
  activeColor = colors.accent,
  activeFill = colors.accentDim,
  dotColor,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  activeColor?: string;
  activeFill?: string;
  dotColor?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: activeFill, borderColor: activeColor },
        pressed && styles.chipPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filter: ${label}`}
    >
      {dotColor ? <View style={[styles.chipDot, { backgroundColor: dotColor }]} /> : null}
      <SectionLabel size="small" style={active ? { color: colors.text } : undefined}>
        {label}
      </SectionLabel>
    </Pressable>
  );
}

/**
 * One sideways-scrolling row of single-select filter chips (the muscle row, the equipment row).
 * Twelve muscles or six equipment kinds would wrap into a wall of chips that pushes the cards off
 * screen, so each set is one scrolling line instead.
 *
 * Inputs: the choices in display order, how to label each, the current choice (or null for "any")
 * and `onChange`. Tapping a chip chooses it; tapping the chosen chip again clears the row (null).
 */
function ChipRow<T extends string>({
  options,
  labelOf,
  value,
  onChange,
}: {
  options: readonly T[];
  labelOf: (option: T) => string;
  value: T | null;
  onChange: (next: T | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      style={styles.chipScroller}
      keyboardShouldPersistTaps="handled"
    >
      {options.map((option) => {
        const active = value === option;
        return (
          <FilterChip
            key={option}
            label={labelOf(option)}
            active={active}
            onPress={() => onChange(active ? null : option)}
          />
        );
      })}
    </ScrollView>
  );
}

/**
 * One library card: exercise name, equipment pill, muscles and pattern, and a chevron showing it
 * opens. Tapping it calls `onOpen` (the screen navigates to the detail screen).
 */
function ExerciseCard({ exercise, onOpen }: { exercise: ExerciseDef; onOpen: () => void }) {
  const regionColor = colors.category[exercise.body];
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${exercise.name}, ${exercise.equipment}, ${exercise.primary}`}
      accessibilityHint="Opens coaching steps and muscles worked"
      testID="exercise-card"
      style={({ pressed }) => pressed && styles.chipPressed}
    >
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitle}>
            <View style={[styles.regionDot, { backgroundColor: regionColor }]} />
            <Body style={styles.cardName}>{exercise.name}</Body>
          </View>
          <View style={styles.cardRight}>
            <View style={styles.equipmentPill}>
              <SectionLabel size="small">{exercise.equipment}</SectionLabel>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.muted}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
        </View>
        <Body variant="small" style={styles.cardMeta}>
          {exercise.primary} · {exercise.patterns[0]}
        </Body>
      </Card>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CategoryKey | null>(null);
  const [muscle, setMuscle] = useState<MuscleKey | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);

  // Filters first (they may re-order by muscle involvement), then the name search, which keeps
  // that order.
  const results = useMemo(
    () => searchExercises(query, filterExercises(ALL_EXERCISES, { body: selected, muscle, equipment })),
    [query, selected, muscle, equipment],
  );

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
            <FilterChip
              key={category.key}
              label={category.label}
              active={active}
              onPress={() => setSelected(active ? null : category.key)}
              activeColor={category.color}
              activeFill={category.dim}
              dotColor={category.color}
            />
          );
        })}
      </View>

      <ChipRow options={MUSCLE_ORDER} labelOf={(key) => MUSCLE_NAMES[key]} value={muscle} onChange={setMuscle} />
      <ChipRow options={EQUIPMENT_ORDER} labelOf={(kind) => kind} value={equipment} onChange={setEquipment} />

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
        renderItem={({ item }) => (
          <ExerciseCard
            exercise={item}
            onOpen={() => router.push({ pathname: '/exercise/[id]', params: { id: item.id } })}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="barbell-outline"
            message="No exercises match that search. Try another name, or clear the filters."
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
  chipScroller: {
    marginTop: spacing.sm,
    flexGrow: 0,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
