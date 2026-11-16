/**
 * Typography primitive tests (B49): headings are announced as headings, every primitive passes
 * the theme's text-size ceiling for its style (body copy none), and the spoken-label and role
 * pass-throughs reach the native text.
 */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

import { fontScaleCaps } from '@/theme';

import { Body, Heading, SectionLabel } from './Text';

describe('Heading', () => {
  it('is announced as a heading', async () => {
    const screen = await render(<Heading>Your history</Heading>);
    expect(screen.getByRole('header', { name: 'Your history' })).toBeTruthy();
  });

  it.each([
    ['display', fontScaleCaps.display],
    ['title', fontScaleCaps.title],
    ['section', fontScaleCaps.sectionTitle],
  ] as const)('caps the %s size at its theme ceiling', async (size, cap) => {
    const screen = await render(<Heading size={size}>Astra</Heading>);
    expect(screen.getByText('Astra').props.maxFontSizeMultiplier).toBe(cap);
  });
});

describe('SectionLabel', () => {
  it('caps both sizes at the label ceilings', async () => {
    const screen = await render(
      <>
        <SectionLabel>Big</SectionLabel>
        <SectionLabel size="small">Small</SectionLabel>
      </>,
    );
    expect(screen.getByText('Big').props.maxFontSizeMultiplier).toBe(fontScaleCaps.label);
    expect(screen.getByText('Small').props.maxFontSizeMultiplier).toBe(fontScaleCaps.labelSmall);
  });

  it('is a plain label unless a screen marks it as a section heading', async () => {
    const screen = await render(
      <>
        <SectionLabel>Plain</SectionLabel>
        <SectionLabel accessibilityRole="header">Tips</SectionLabel>
      </>,
    );
    expect(screen.queryByRole('header', { name: 'Plain' })).toBeNull();
    expect(screen.getByRole('header', { name: 'Tips' })).toBeTruthy();
  });
});

describe('Body', () => {
  it('grows with the phone’s text size without a ceiling', async () => {
    const screen = await render(<Body>Read me</Body>);
    expect(screen.getByText('Read me').props.maxFontSizeMultiplier).toBeUndefined();
  });

  it('takes the ceiling of the style it is drawn as, when told', async () => {
    const screen = await render(<Body scaleAs="statValue">42</Body>);
    expect(screen.getByText('42').props.maxFontSizeMultiplier).toBe(fontScaleCaps.statValue);
  });

  it('can speak a fuller label than its shorthand, and be a heading', async () => {
    const screen = await render(
      <>
        <Body accessibilityLabel="Drop 1: 5 × 185 lb">↳ 5 × 185 lb</Body>
        <Body accessibilityRole="header">Bench Press</Body>
      </>,
    );
    expect(screen.getByLabelText('Drop 1: 5 × 185 lb')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Bench Press' })).toBeTruthy();
  });
});
