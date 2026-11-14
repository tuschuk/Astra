/**
 * Layout shared by the sign-in and sign-up forms, so the two screens stay
 * visually identical: evenly spaced sections, the title pushed down from the
 * top edge, and a tighter gap between the input fields.
 */
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';

export const authFormStyles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
  title: {
    marginTop: spacing.xxxl,
  },
  fields: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
});
