/**
 * Typography primitives. Screens use these instead of raw <Text> so every
 * piece of text goes through the theme's named styles:
 *
 * - <Heading>      — Permanent Marker display/title/section sizes
 * - <SectionLabel> — the signature uppercase tracked Space Grotesk label
 * - <Body>         — Manrope body copy (normal, muted or small)
 *
 * Accessibility (B49): all three grow with the phone's text-size setting. Body copy grows
 * without limit (it's what people read); headings and labels grow up to the ceiling set for
 * their style in the theme's `fontScaleCaps`, so huge text can't push a screen apart. A heading
 * is announced as a heading, so screen-reader users can jump between sections. A screen can
 * also mark any body line as a heading (an exercise name on its card) or give it a spoken
 * label when the drawn text is shorthand ("↳ 5 × 185 lb" read as "Drop 1: 5 × 185 lb").
 */
import React from 'react';
import { Text, type AccessibilityRole, type StyleProp, type TextStyle } from 'react-native';

import { fontScaleCaps, type } from '@/theme';

interface ThemedTextProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  /** What a screen reader calls this text ("header" for a card's title); none by default. */
  accessibilityRole?: AccessibilityRole;
  /** What a screen reader says instead of the drawn text, when the drawn text is shorthand. */
  accessibilityLabel?: string;
  /** Cuts the text off after this many lines (use only for titles, never for information). */
  numberOfLines?: number;
}

interface HeadingProps extends Omit<ThemedTextProps, 'accessibilityRole'> {
  /** display = hero, title = screen title (default), section = card heading. */
  size?: 'display' | 'title' | 'section';
}

/** Marker-style heading. Display sizes only — never for small text. Always announced as a heading. */
export function Heading({ size = 'title', style, children, ...textProps }: HeadingProps) {
  const styleName = size === 'display' ? 'display' : size === 'section' ? 'sectionTitle' : 'title';
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={fontScaleCaps[styleName]}
      style={[type[styleName], style]}
      {...textProps}
    >
      {children}
    </Text>
  );
}

interface SectionLabelProps extends ThemedTextProps {
  /** small = the 10px variant for tight metadata rows. */
  size?: 'default' | 'small';
}

/** Uppercase, wide-tracked Space Grotesk label — the system's field/section marker. */
export function SectionLabel({ size = 'default', style, children, ...textProps }: SectionLabelProps) {
  const styleName = size === 'small' ? 'labelSmall' : 'label';
  return (
    <Text maxFontSizeMultiplier={fontScaleCaps[styleName]} style={[type[styleName], style]} {...textProps}>
      {children}
    </Text>
  );
}

interface BodyProps extends ThemedTextProps {
  /** muted = secondary copy, small = card metadata. */
  variant?: 'default' | 'muted' | 'small';
  /**
   * Only when `style` restyles this line as a capped style (a stat value in a tile): names that
   * style so the line grows no further than its `fontScaleCaps` entry. Omitted = uncapped.
   */
  scaleAs?: keyof typeof fontScaleCaps;
}

/** Manrope body text. Grows with the phone's text size, uncapped unless `scaleAs` says otherwise. */
export function Body({ variant = 'default', style, children, scaleAs, ...textProps }: BodyProps) {
  const base =
    variant === 'muted' ? type.bodyMuted : variant === 'small' ? type.bodySmall : type.body;
  return (
    <Text
      maxFontSizeMultiplier={scaleAs ? fontScaleCaps[scaleAs] : undefined}
      style={[base, style]}
      {...textProps}
    >
      {children}
    </Text>
  );
}
