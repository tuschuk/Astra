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
 * exercise's detail screen (coaching steps, tips, muscles worked, and the lifter's own history).
 * Demo videos (LIB-2) arrive in a later step.
 *
 * "Your exercises" (LIB-5, B31): above the library's count line sits the lifter's own custom
 * exercises, read from the phone's database (re-read each time the tab comes into focus, so an
 * exercise deleted on its card is gone on return). They obey the same search box and the muscle
 * and equipment chips; a region chip hides them (customs have no region). "New exercise" opens a
 * form to make one — it works with no signal and uploads with the next sync — and tapping a custom
 * card opens its own card, where it can be edited or deleted. Customs are private: nobody else
 * ever sees them.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CustomExerciseForm } from '@/components/library/CustomExerciseForm';
import { CustomPill } from '@/components/library/CustomPill';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { ExerciseRow } from '@/db/dao';
import {
  ALL_EXERCISES,
  BODY_REGION_LABELS,
  EQUIPMENT_ORDER,
  filterExercises,
  searchExercises,
  type ExerciseDef,
} from '@/library/catalog';
import { filterCustomExercises } from '@/library/customExercises';
import type { Equipment, MuscleKey } from '@/library/exercises';
import { asMuscleKey, MUSCLE_NAMES, MUSCLE_ORDER } from '@/library/muscles';
import { useCustomExercises } from '@/library/useCustomExercises';
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

/**
 * One of the lifter's own exercises as a card (B31): name, a "Custom" pill in place of the region
 * dot (customs have no region), its equipment if set, and its main muscle if set. Tapping it calls
 * `onOpen` (the screen opens the custom's card, where it can be edited or deleted).
 */
function CustomExerciseCard({ exercise, onOpen }: { exercise: ExerciseRow; onOpen: () => void }) {
  const muscle = asMuscleKey(exercise.primary_muscle);
  const muscleName = muscle ? MUSCLE_NAMES[muscle] : null;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={['Custom exercise', exercise.name, exercise.equipment, muscleName].filter(Boolean).join(', ')}
      accessibilityHint="Opens your exercise, its history, and Edit and Delete"
      testID="custom-exercise-card"
      style={({ pressed }) => pressed && styles.chipPressed}
    >
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitle}>
            <CustomPill />
            <Body style={styles.cardName}>{exercise.name}</Body>
          </View>
          <View style={styles.cardRight}>
            {exercise.equipment ? (
              <View style={styles.equipmentPill}>
                <SectionLabel size="small">{exercise.equipment}</SectionLabel>
              </View>
            ) : null}
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.muted}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
        </View>
        {muscleName ? (
          <Body variant="small" style={styles.cardMeta}>
            {muscleName}
          </Body>
        ) : null}
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
  const { customs, reload, db, userId } = useCustomExercises();
  // Bumped on every opening of the New exercise form, so each opening starts with a blank draft.
  const [formKey, setFormKey] = useState<number | null>(null);

  // Filters first (they may re-order by muscle involvement), then the name search, which keeps
  // that order.
  const results = useMemo(
    () => searchExercises(query, filterExercises(ALL_EXERCISES, { body: selected, muscle, equipment })),
    [query, selected, muscle, equipment],
  );
  // The lifter's own exercises obey the same search and chips (a region chip hides them all —
  // they have no region; see `filterCustomExercises`).
  const customResults = useMemo(
    () => filterCustomExercises(customs, { query, body: selected, muscle, equipment }),
    [customs, query, selected, muscle, equipment],
  );

  /** Opens a custom exercise's card (the same detail route, keyed by its database id). */
  function openCustom(id: string): void {
    router.push({ pathname: '/exercise/[id]', params: { id } });
  }

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

      <View style={styles.customHeader}>
        <SectionLabel accessibilityRole="header">Your exercises</SectionLabel>
        <Button label="New exercise" variant="ghost" onPress={() => setFormKey((k) => (k ?? 0) + 1)} />
      </View>
      {customResults.map((exercise) => (
        <CustomExerciseCard key={exercise.id} exercise={exercise} onOpen={() => openCustom(exercise.id)} />
      ))}
      {customs.length === 0 ? (
        <Body variant="small" style={styles.customEmpty}>
          Add a movement the library doesn’t have. It’s private to you.
        </Body>
      ) : null}

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
            message={
              customResults.length > 0
                ? 'No library exercises match that search.'
                : 'No exercises match that search. Try another name, or clear the filters.'
            }
          />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
      />
      {formKey !== null ? (
        <CustomExerciseForm
          key={formKey}
          visible
          db={db}
          userId={userId}
          existing={null}
          onSaved={() => {
            setFormKey(null);
            void reload();
          }}
          onClose={() => setFormKey(null)}
        />
      ) : null}
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
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  customEmpty: {
    color: colors.muted,
  },
});
