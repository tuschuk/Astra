/**
 * FormError — the red error line under a form ("That email and password
 * don't match an account."). Renders nothing when there's no message.
 * Marked as an alert so screen readers announce it as soon as it appears.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

import { Body } from './Text';

interface FormErrorProps {
  /** The message to show, or null for none. */
  message: string | null;
  style?: StyleProp<ViewStyle>;
}

export function FormError({ message, style }: FormErrorProps) {
  if (!message) return null;
  return (
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={style}>
      <Body style={styles.text}>{message}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  text: {
    color: colors.error,
  },
});
