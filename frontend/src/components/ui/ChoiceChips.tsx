/**
 * ChoiceChips — a row of tappable chips where exactly one is chosen (a radio group).
 *
 * What it shows: one chip per option, the chosen one lit in the accent red. Used by the Tool
 * Kit for its calculator switcher, the RPE calculator's reps and RPE pickers, and the plate
 * loader's kg | lb rack toggle; by the Home feed and profile for their switchers; and (B26) by
 * Settings → Privacy and a post's "who can see this" chooser — places where the answer is one
 * of a few fixed values, so a tap is faster than typing and a value outside the allowed range
 * can't be entered at all. (Moved from `components/toolkit/` to `components/ui/` at B26, once it
 * served more than the Tool Kit.)
 *
 * What the lifter can do: tap a chip to choose it. Screen readers hear a radio group, each
 * chip's spoken label, and which one is selected (the Settings unit-toggle pattern).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SectionLabel } from '@/components/ui/Text';
import { colors, layout, radii, spacing } from '@/theme';

/** One chip: its value, the text on it, and what a screen reader says for it. */
export interface ChoiceOption<T> {
  value: T;
  label: string;
  spoken: string;
}

interface ChoiceChipsProps<T> {
  options: readonly ChoiceOption<T>[];
  /** The chosen value. */
  selected: T;
  onSelect: (value: T) => void;
  /** Stretch the chips to share the row evenly (a switcher) instead of wrapping (a picker). */
  fill?: boolean;
  /** Greys the chips out and ignores taps (the timer's mode chips while a timer is running). */
  disabled?: boolean;
}

export function ChoiceChips<T extends string | number>({
  options,
  selected,
  onSelect,
  fill = false,
  disabled = false,
}: ChoiceChipsProps<T>) {
  return (
    <View style={[styles.row, fill && styles.rowFill]} accessibilityRole="radiogroup">
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onSelect(option.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={option.spoken}
            accessibilityState={{ selected: active, checked: active, disabled }}
            style={({ pressed }) => [
              styles.chip,
              fill && styles.chipFill,
              active && styles.chipActive,
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}
          >
            <SectionLabel style={active ? styles.labelActive : undefined}>{option.label}</SectionLabel>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowFill: {
    flexWrap: 'nowrap',
  },
  chip: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceDeep,
  },
  chipFill: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
  chipActive: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
  },
  labelActive: {
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
