/**
 * The contrast check (B49, NFR-10 "meet contrast minimums").
 *
 * Two halves:
 *   1. The WCAG math in `contrast.ts` agrees with WCAG's own reference values.
 *   2. Every color pair the app actually draws meets its WCAG 2.1 AA minimum: 4.5:1 for normal
 *      text, 3:1 for icons and other non-text controls (1.4.11). Translucent tokens are measured
 *      as they really render — laid over the page background (and over the card surface, for
 *      things drawn inside a card).
 *
 * The pair list is written out by hand from the call sites (the same mirror-by-hand trade the
 * repo makes for `limits.ts`): a new screen that draws a new pair adds it here. Nothing outside
 * `src/theme` may hardcode a color, so the tokens are the only colors there are to check.
 */
import { describe, expect, it } from '@jest/globals';

import { compositeOver, contrastRatio, parseColor, relativeLuminance } from './contrast';
import { colors } from './tokens';

/** WCAG 2.1 AA minimums. */
const NORMAL_TEXT = 4.5;
const NON_TEXT = 3;

/** Lays translucent layers over the page background, bottom first — what a nested surface looks like. */
function over(...layers: string[]): string {
  return layers.reduce((base, layer) => compositeOver(layer, base), colors.bg as string);
}

/** The backgrounds text is drawn on, flattened to the solid color the eye sees. */
const BACKGROUNDS = {
  bg: colors.bg,
  navBg: colors.navBg,
  surface: over(colors.surface),
  surfaceHover: over(colors.surface, colors.surfaceHover),
  surfaceDeep: over(colors.surfaceDeep),
  // A text box inside a card: the input's translucent black over the card's lift.
  inputInCard: over(colors.surface, colors.inputBg),
  // An active chip inside a card.
  accentDimInCard: over(colors.surface, colors.accentDim),
  // The focused profile button floating on the page.
  accentDimOnPage: over(colors.accentDim),
} as const;

describe('contrast math (WCAG 2.1)', () => {
  it('matches the published extremes: white on black is 21:1, a color on itself 1:1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('matches known reference ratios', () => {
    // Widely published values: #767676 on white is the lightest grey passing 4.5:1 (≈ 4.54).
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    // Pure red on white ≈ 4.0:1.
    expect(contrastRatio('#ff0000', '#ffffff')).toBeCloseTo(4.0, 1);
  });

  it('computes relative luminance at the ends of the scale', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('lays a translucent color over its base before measuring', () => {
    expect(compositeOver('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080');
    expect(compositeOver('rgba(0, 0, 0, 0)', '#123456')).toBe('#123456');
    expect(compositeOver('#abcdef', '#000000')).toBe('#abcdef');
  });

  it('reads the two color formats the theme uses, and refuses anything else', () => {
    expect(parseColor('#cc0404')).toEqual({ r: 204, g: 4, b: 4, a: 1 });
    expect(parseColor('rgba(255, 255, 255, 0.72)')).toEqual({ r: 255, g: 255, b: 255, a: 0.72 });
    expect(() => parseColor('red')).toThrow();
    expect(() => relativeLuminance('rgba(0, 0, 0, 0.5)')).toThrow();
    expect(() => compositeOver('#ffffff', 'rgba(0, 0, 0, 0.5)')).toThrow();
  });
});

/** A [foreground, background name, where it's drawn] triple. */
type Pair = readonly [string, keyof typeof BACKGROUNDS, string];

/** Text that carries information — must reach 4.5:1. */
const TEXT_PAIRS: readonly Pair[] = [
  [colors.text, 'bg', 'primary text on the page'],
  [colors.text, 'surface', 'card titles and set lines'],
  [colors.text, 'surfaceHover', 'a pressed row'],
  [colors.text, 'surfaceDeep', 'Tool Kit tiles, chips'],
  [colors.text, 'inputInCard', 'typed text in the logger boxes'],
  [colors.muted, 'bg', 'secondary text and labels'],
  [colors.muted, 'surface', 'muted lines inside cards (last time, notes)'],
  [colors.muted, 'surfaceDeep', 'idle chip labels'],
  [colors.muted, 'navBg', 'idle tab labels'],
  [colors.muted, 'inputInCard', 'placeholders (format hints) in the logger boxes'],
  [colors.accentText, 'bg', 'small red labels on the page (Flair, author links)'],
  [colors.accentText, 'surface', 'History link, Superset tag, PR badge, analysis section labels'],
  [colors.accentText, 'navBg', 'the focused tab label'],
  [colors.text, 'accentDimInCard', 'an active chip’s label in a card'],
  [colors.error, 'bg', 'form errors'],
  [colors.error, 'surface', 'errors inside cards'],
  [colors.warn, 'bg', 'warnings'],
  [colors.info, 'bg', 'caution badges'],
  [colors.gold, 'bg', 'PR stars and highlights'],
  [colors.green, 'bg', 'completion text'],
  [colors.green, 'surface', 'completion text in a card'],
];

describe('every information-bearing text pair meets WCAG AA (4.5:1)', () => {
  it.each(TEXT_PAIRS)('%s on %s — %s', (fg, bgName) => {
    expect(contrastRatio(fg, BACKGROUNDS[bgName])).toBeGreaterThanOrEqual(NORMAL_TEXT);
  });

  it('white button labels on the solid red buttons (resting and pressed)', () => {
    expect(contrastRatio(colors.text, colors.accent)).toBeGreaterThanOrEqual(NORMAL_TEXT);
    expect(contrastRatio(colors.text, colors.accentBright)).toBeGreaterThanOrEqual(NORMAL_TEXT);
  });

  it('category colors on their own dim fills, and completion green on its fill', () => {
    const { category } = colors;
    for (const [fg, fill] of [
      [category.upper, category.upperDim],
      [category.lower, category.lowerDim],
      [category.core, category.coreDim],
      [category.cardio, category.cardioDim],
      [colors.green, colors.greenDim],
    ] as const) {
      expect(contrastRatio(fg, over(fill))).toBeGreaterThanOrEqual(NORMAL_TEXT);
    }
  });
});

/** Icons and other non-text marks that carry meaning — must reach 3:1. */
const NON_TEXT_PAIRS: readonly Pair[] = [
  [colors.accent, 'bg', 'the red identity on the page: lit vote arrows, active chip borders, chart lines'],
  [colors.accent, 'surface', 'a lit vote arrow inside a post card'],
  [colors.accent, 'navBg', 'the focused tab icon'],
  // (A toggle's red border when on is measured against what's outside it — the card surface, above.)
  [colors.accent, 'accentDimOnPage', 'the focused profile button’s icon on its red-tinted fill'],
  [colors.muted, 'surface', 'idle icon buttons in cards'],
  [colors.muted, 'navBg', 'idle tab icons'],
];

describe('every meaningful non-text mark meets WCAG AA (3:1)', () => {
  it.each(NON_TEXT_PAIRS)('%s on %s — %s', (fg, bgName) => {
    expect(contrastRatio(fg, BACKGROUNDS[bgName])).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it('the brand red alone is NOT readable as small text — why `accentText` exists', () => {
    // A guard on the reasoning: if `accent` ever passed 4.5:1 the split token could be retired.
    expect(contrastRatio(colors.accent, colors.bg)).toBeLessThan(NORMAL_TEXT);
    expect(contrastRatio(colors.accentText, colors.bg)).toBeGreaterThanOrEqual(NORMAL_TEXT);
  });
});

/*
 * Deliberately not checked, each for a stated reason:
 * - `mutedDecor` — documented decorative-only (empty-state icons); it carries no information.
 * - `border`, `gridLine`, `navBorder`, `greenBorder` — hairlines and texture that separate or
 *   decorate; nothing is identified by them alone.
 * - `borderStrong`, `accentBorder` — the outlines of inputs, ghost buttons and chips. WCAG 1.4.11
 *   requires a 3:1 boundary only when the boundary is what identifies the control; every Astra
 *   control is identified by its own text label (or field label above it), and a chip's
 *   selected state is also spoken. Raising these to 3:1 would restyle every control in the app —
 *   recorded in the B49 plan's Deviations as a product call for Tristen, not changed here.
 * - Glow shadows — decoration.
 */
