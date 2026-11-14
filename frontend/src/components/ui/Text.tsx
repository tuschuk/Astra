/**
 * Typography primitives. Screens use these instead of raw <Text> so every
 * piece of text goes through the theme's named styles:
 *
 * - <Heading>      — Permanent Marker display/title/section sizes
 * - <SectionLabel> — the signature uppercase tracked Space Grotesk label
 * - <Body>         — Manrope body copy (normal, muted or small)
 */
import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { type } from '@/theme';

interface ThemedTextProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

interface HeadingProps extends ThemedTextProps {
  /** display = hero, title = screen title (default), section = card heading. */
  size?: 'display' | 'title' | 'section';
}

/** Marker-style heading. Display sizes only — never for small text. */
export function Heading({ size = 'title', style, children }: HeadingProps) {
  const base =
    size === 'display' ? type.display : size === 'section' ? type.sectionTitle : type.title;
  return (
    <Text accessibilityRole="header" style={[base, style]}>
      {children}
    </Text>
  );
}

interface SectionLabelProps extends ThemedTextProps {
  /** small = the 10px variant for tight metadata rows. */
  size?: 'default' | 'small';
}

/** Uppercase, wide-tracked Space Grotesk label — the system's field/section marker. */
export function SectionLabel({ size = 'default', style, children }: SectionLabelProps) {
  return <Text style={[size === 'small' ? type.labelSmall : type.label, style]}>{children}</Text>;
}

interface BodyProps extends ThemedTextProps {
  /** muted = secondary copy, small = card metadata. */
  variant?: 'default' | 'muted' | 'small';
}

/** Manrope body text. */
export function Body({ variant = 'default', style, children }: BodyProps) {
  const base =
    variant === 'muted' ? type.bodyMuted : variant === 'small' ? type.bodySmall : type.body;
  return <Text style={[base, style]}>{children}</Text>;
}
