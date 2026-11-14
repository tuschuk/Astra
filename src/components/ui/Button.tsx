/**
 * Button — the three button recipes from the styling guide.
 *
 * - primary: solid brand red with a neon glow; the screen's main action.
 * - ghost:   transparent with a hairline border; secondary actions.
 * - outline: transparent with a red border that fills red when pressed.
 *
 * All variants meet the 44px minimum touch target and use the system's
 * uppercase tracked button type style.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, glows, layout, radii, spacing, type } from '@/theme';

export type ButtonVariant = 'primary' | 'ghost' | 'outline';

interface ButtonProps {
  /** What the button does, in the user's words ("Start workout"). */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, variant = 'primary', disabled = false, style }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && [styles.primary, !disabled && glows.accentSm],
        variant === 'primary' && pressed && styles.primaryPressed,
        variant === 'ghost' && styles.ghost,
        variant === 'ghost' && pressed && styles.ghostPressed,
        variant === 'outline' && styles.outline,
        variant === 'outline' && pressed && styles.outlinePressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {({ pressed }) => (
        <Text
          style={[
            type.button,
            variant === 'ghost' && !pressed && styles.ghostLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  primaryPressed: {
    backgroundColor: colors.accentBright,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ghostPressed: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
  },
  ghostLabel: {
    color: colors.muted,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  outlinePressed: {
    backgroundColor: colors.accent,
  },
  disabled: {
    opacity: 0.4,
  },
});
