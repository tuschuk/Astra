/**
 * Library — the exercise library (LIB-1..LIB-7): every exercise as a card
 * with search and muscle/equipment filters. This foundation renders the
 * search field and the four muscle-group filter chips (with the category
 * colors from the styling guide) over the library's empty state; the card
 * grid fills in when the launch library (LIB-7) is imported.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { colors, radii, spacing, type } from '@/theme';

/** The four filter categories and their identity colors (styling guide §1). */
const CATEGORIES = [
  { key: 'upper', label: 'Upper', color: colors.category.upper, dim: colors.category.upperDim },
  { key: 'lower', label: 'Lower', color: colors.category.lower, dim: colors.category.lowerDim },
  { key: 'core', label: 'Core', color: colors.category.core, dim: colors.category.coreDim },
  { key: 'cardio', label: 'Cardio', color: colors.category.cardio, dim: colors.category.cardioDim },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]['key'];

export default function LibraryScreen() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CategoryKey | null>(null);

  return (
    <Screen>
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

      <EmptyState
        icon="barbell-outline"
        message="The exercise library is on its way — around 100 movements with demo videos and coaching cues. Your custom exercises will live here too."
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
});
