/**
 * Color-contrast math (WCAG 2.1) — how readable one color is on top of another.
 *
 * Why this exists: Astra's palette is dark, translucent and red, which is exactly the kind of
 * palette where text quietly becomes hard to read. WCAG publishes a formula that turns two
 * colors into a "contrast ratio" from 1:1 (invisible) to 21:1 (white on black), with minimums:
 * 4.5:1 for normal text, 3:1 for large text and for the outlines/icons of controls. The theme
 * test (`contrast.test.ts`) runs every color pair the app actually uses through these functions,
 * so a token edit that makes text unreadable fails the test suite instead of shipping.
 *
 * Only tests import this file — nothing at runtime measures contrast. Colors are the formats the
 * theme uses: `#rrggbb` and `rgba(r, g, b, a)`.
 */

/** A color as red/green/blue channels (0–255) plus opacity (0–1). */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Reads a theme color string into its channels. Accepts `#rrggbb` (fully opaque) and
 * `rgba(r, g, b, a)`. Anything else is a mistake in the test's pair list, so it throws.
 */
export function parseColor(color: string): Rgba {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) {
    return { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: 1 };
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(color);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: Number(rgba[4]) };
  }
  throw new Error(`Unsupported color format: ${color}`);
}

/**
 * Lays a (possibly see-through) color on top of a solid one and returns the solid color the eye
 * actually sees. Needed because Astra's surfaces and secondary text are translucent whites — a
 * 72%-white label's real color depends on what's behind it, and the contrast formula only works
 * on solid colors. The base must be opaque (it's the page background or an already-flattened
 * surface).
 */
export function compositeOver(overlay: string, base: string): string {
  const top = parseColor(overlay);
  const bottom = parseColor(base);
  if (bottom.a !== 1) throw new Error(`Base color must be opaque: ${base}`);
  const mix = (t: number, b: number) => Math.round(t * top.a + b * (1 - top.a));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(top.r, bottom.r))}${toHex(mix(top.g, bottom.g))}${toHex(mix(top.b, bottom.b))}`;
}

/**
 * How bright a solid color looks to the human eye, from 0 (black) to 1 (white), per WCAG's
 * "relative luminance" definition (green counts most, blue least, after undoing screen gamma).
 */
export function relativeLuminance(color: string): number {
  const { r, g, b, a } = parseColor(color);
  if (a !== 1) throw new Error(`Luminance needs an opaque color: ${color}`);
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * The WCAG contrast ratio of a foreground color on a background, from 1 to 21. The background
 * must be solid; a see-through foreground is first laid over it (so `muted` text is measured as
 * the grey it really renders as). Higher is more readable: ≥ 4.5 passes normal text, ≥ 3 passes
 * large text and control outlines.
 */
export function contrastRatio(foreground: string, background: string): number {
  const fg = compositeOver(foreground, background);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(background);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
