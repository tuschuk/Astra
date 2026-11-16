/**
 * Theme invariants. These don't echo token values back (that would just be a
 * second copy of the file) — they pin the conventions the design system
 * depends on, so a careless edit can't silently break them.
 */
import { describe, expect, it } from '@jest/globals';

import { colors, fonts, fontScaleCaps, layout, type } from './tokens';

describe('theme tokens', () => {
  it('keeps completion green distinct from the brand accent', () => {
    // The system's core rule: red is identity, green means "done".
    expect(colors.green).not.toBe(colors.accent);
    expect(colors.greenDim).not.toBe(colors.accentDim);
  });

  it('keeps the minimum touch target at the accessibility floor', () => {
    expect(layout.minTouchTarget).toBeGreaterThanOrEqual(44);
  });

  it('uses only registered font families in type styles', () => {
    const registered = new Set<string>(Object.values(fonts));
    for (const style of Object.values(type)) {
      expect(registered).toContain(style.fontFamily);
    }
  });

  it('reserves the marker heading font for display sizes (≥ 20px)', () => {
    // Permanent Marker is illegible small; the guide restricts it to titles.
    for (const style of Object.values(type)) {
      if (style.fontFamily === fonts.heading) {
        expect(style.fontSize).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('(B49) caps text growth only on real type styles, and never below its base size', () => {
    // A cap below 1 would *shrink* text for the people who turned text size up.
    for (const [style, cap] of Object.entries(fontScaleCaps)) {
      expect(Object.keys(type)).toContain(style);
      expect(cap).toBeGreaterThanOrEqual(1);
    }
  });

  it('(B49) leaves the text people read uncapped — body copy, inputs and card titles', () => {
    // WCAG 1.4.4: content text must reach 200%. These styles are deliberately absent from the caps.
    for (const style of ['body', 'bodyMuted', 'bodySmall', 'input', 'cardTitle']) {
      expect(Object.keys(fontScaleCaps)).not.toContain(style);
    }
  });

  it('(B49) lets small labels and buttons reach at least double size', () => {
    expect(fontScaleCaps.label).toBeGreaterThanOrEqual(2);
    expect(fontScaleCaps.labelSmall).toBeGreaterThanOrEqual(2);
    expect(fontScaleCaps.button).toBeGreaterThanOrEqual(2);
  });

  it('(B49) keeps the readable small-text red distinct from the brand red', () => {
    expect(colors.accentText).not.toBe(colors.accent);
  });

  it('uppercases every tracked label style', () => {
    // The signature label is uppercase + wide tracking; one without the other
    // is a half-applied style.
    for (const style of [type.label, type.labelSmall, type.button]) {
      expect(style.textTransform).toBe('uppercase');
      expect(style.letterSpacing).toBeGreaterThan(0);
    }
  });
});
