/**
 * EmptyState — the standard "nothing here yet" block. An empty screen is an
 * invitation to act, so every empty state names what will fill it and offers
 * the action that starts that.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '@/theme';

import { Body } from './Text';
import { Button, type ButtonVariant } from './Button';

interface EmptyStateProps {
  /** Ionicons icon name shown faintly above the message. */
  icon: keyof typeof Ionicons.glyphMap;
  /** One sentence: what's empty and why that's an invitation. */
  message: string;
  /** Optional call to action. */
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: ButtonVariant;
}

export function EmptyState({
  icon,
  message,
  actionLabel,
  onAction,
  actionVariant = 'ghost',
}: EmptyStateProps) {
  return (
    <View style={styles.root}>
      {/* Decorative — the message text carries the meaning. */}
      <Ionicons
        name={icon}
        size={36}
        color={colors.mutedDecor}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Body variant="muted" style={styles.message}>
        {message}
      </Body>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant={actionVariant} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  message: {
    textAlign: 'center',
    maxWidth: 280,
  },
});
