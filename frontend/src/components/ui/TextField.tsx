/**
 * TextField — a labeled text input in the Astra style.
 *
 * Shows an uppercase field label above a dark translucent input box, with a
 * red border while focused. The label doubles as the input's accessibility
 * label so screen readers (and tests) can find the field by name.
 */
import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { colors, layout, radii, spacing, type } from '@/theme';

import { SectionLabel } from './Text';

interface TextFieldProps extends Omit<TextInputProps, 'style' | 'accessibilityLabel'> {
  /** The field's name, shown above it ("Email"). */
  label: string;
  /** Styling for the outer wrapper (label + box). */
  style?: StyleProp<ViewStyle>;
}

export function TextField({ label, style, onFocus, onBlur, ...inputProps }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrapper, style]}>
      <SectionLabel size="small">{label}</SectionLabel>
      <TextInput
        accessibilityLabel={label}
        // Placeholders carry format hints (MM / DD / YYYY), so they use the
        // informational muted tone, not the decorative-only one.
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, focused && styles.inputFocused]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  input: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBg,
    ...type.input,
  },
  inputFocused: {
    borderColor: colors.accentBorder,
  },
});
