/**
 * The geometry of one trend chart (B46) — where the line, the dots, the axis labels go — worked
 * out as plain data so `TrendChart` only has to draw it. Pure: no React, no I/O, no clock.
 *
 * Why it exists as its own file: hand-drawn charts go wrong at the edges (one point, a flat line,
 * two sessions on the same day, round numbers in pounds), and every one of those is a fixture
 * test here instead of a surprise on a phone.
 *
 * The rules it follows:
 *   - every weight is converted to the lifter's unit with `displayWeight` *before* the axis picks
 *     its round numbers, so a pounds chart reads 200 / 250 / 300 lb, never 220.5 / 441 lb;
 *   - time runs left to right, oldest to newest, spaced by real dates (not by session number);
 *   - dates are written from fixed month names, never the phone's locale, so every phone prints
 *     the same labels;
 *   - an axis is either anchored at 0 (`baseline: 'zero'` — volume, a quantity, where a cut-off
 *     axis would exaggerate small changes) or fitted to the data (`'fit'` — an e1RM never comes
 *     near 0, and a 0-based axis would flatten real progress into a line).
 */
import { displayWeight, type WeightUnit } from '@training-math';

import { groupThousands, MONTHS, shortDateLabel } from '@/workout/format';
import type { TrendPoint } from '@/workout/trendSeries';

/** The most sessions that still get a dot each; past this the dots would merge into a smear. */
export const MAX_MARKERS = 40;

/** How many value labels the side axis aims for (it lands on 3–5 after rounding to nice steps). */
const TARGET_Y_TICKS = 4;

/** How many date labels the bottom axis aims for, at most. */
const TARGET_X_TICKS = 4;

/** Under this span, date labels say the day ("Nov 12"); over it, the month ("Nov 2026"). */
const DAY_LABEL_SPAN_MS = 60 * 24 * 60 * 60 * 1000;

/** Room around the plot: top and right a little, bottom for the dates; left is sized to the labels. */
const PAD_TOP = 8;
const PAD_RIGHT = 12;
const PAD_BOTTOM = 22;
/** Rough width of one axis-label character at the chart's small font, for sizing the left margin. */
const LABEL_CHAR_WIDTH = 6.5;

/** How the value axis is anchored (see the file comment). */
export type ChartBaseline = 'zero' | 'fit';

/** What a chart is asked to draw. */
export interface ChartOptions {
  width: number;
  height: number;
  unit: WeightUnit;
  baseline: ChartBaseline;
}

/** A spot on the drawing, in pixels from the top-left corner. */
export interface ChartSpot {
  x: number;
  y: number;
}

/** The finished drawing plan. */
export interface ChartLayout {
  /** The line through the points as an SVG path ("M x y L x y …"), or null for a single point. */
  path: string | null;
  /** One dot per session — empty when there are more than `MAX_MARKERS` (so a lone point always has its dot). */
  markers: ChartSpot[];
  /** Value labels up the left side: where each sits and its text ("150"). */
  yTicks: { y: number; label: string }[];
  /** Date labels along the bottom: where each sits and its text ("Mar 2026"). */
  xTicks: { x: number; label: string }[];
  /** The plotting area inside the margins. */
  plot: { left: number; top: number; right: number; bottom: number };
}

/** A shown weight with up to one decimal and thousands separators: 8400 → "8,400", 151.7 → "151.7". */
export function formatChartWeight(value: number): string {
  return groupThousands(value, Number.isInteger(value) ? 0 : 1);
}

/** The smallest "nice" step (1, 2, 2.5 or 5 × a power of ten) at least as big as `raw`. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (factor * magnitude >= raw - 1e-9) return factor * magnitude;
  }
  return 10 * magnitude;
}

/** Decimal places a step needs to print exactly (2.5 → 1, 0.25 → 2, 50 → 0). */
function stepDecimals(step: number): number {
  for (let d = 0; d <= 6; d += 1) {
    if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  }
  return 6;
}

/**
 * The value axis's range and labels, in the lifter's unit: round numbers that cover every value.
 * A flat series (every value equal) still gets a real range around it, so nothing divides by zero.
 */
export function valueAxis(values: readonly number[], baseline: ChartBaseline): { min: number; max: number; ticks: number[]; decimals: number } {
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (baseline === 'zero') {
    low = 0;
    if (high <= 0) high = 10;
  } else if (high === low) {
    const pad = Math.max(Math.abs(high) * 0.05, 5);
    low = high - pad;
    high += pad;
  } else {
    const pad = (high - low) * 0.1;
    low -= pad;
    high += pad;
  }
  if (baseline === 'fit') low = Math.max(0, low);
  const step = niceStep((high - low) / (TARGET_Y_TICKS - 1));
  const min = Math.floor(low / step + 1e-9) * step;
  const max = Math.ceil(high / step - 1e-9) * step;
  const decimals = stepDecimals(step);
  const ticks: number[] = [];
  for (let i = 0; min + i * step <= max + step / 1000; i += 1) {
    ticks.push(Number((min + i * step).toFixed(decimals)));
  }
  return { min, max, ticks, decimals };
}

/**
 * The date labels: up to `TARGET_X_TICKS` evenly spread across the span from the first session
 * to the last, each "Nov 12" for a short span or "Nov 2026" for a long one. Neighbouring labels
 * that would print the same text are merged into the first. All sessions on one moment → one label.
 */
function timeTicks(firstMs: number, lastMs: number): { ms: number; label: string }[] {
  const span = lastMs - firstMs;
  const label = (ms: number) => {
    const d = new Date(ms);
    return span < DAY_LABEL_SPAN_MS ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  };
  if (span <= 0) return [{ ms: firstMs, label: label(firstMs) }];
  const ticks: { ms: number; label: string }[] = [];
  for (let i = 0; i < TARGET_X_TICKS; i += 1) {
    const ms = firstMs + (span * i) / (TARGET_X_TICKS - 1);
    const text = label(ms);
    if (ticks[ticks.length - 1]?.label !== text) ticks.push({ ms, label: text });
  }
  return ticks;
}

/** One decimal place for pixel coordinates — plenty for a phone, and stable in tests. */
function px(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The whole drawing plan for a series of sessions (oldest first), or null when there is nothing
 * to draw (no points, or no width yet). Inputs: the points in kg and the chart's size, unit and
 * baseline. Output: the line, the dots and both axes' labels, in pixels.
 */
export function buildChartLayout(points: readonly TrendPoint[], options: ChartOptions): ChartLayout | null {
  const { width, height, unit, baseline } = options;
  if (points.length === 0 || !(width > 0) || !(height > 0)) return null;

  const values = points.map((p) => displayWeight(p.valueKg, unit));
  const axis = valueAxis(values, baseline);
  const yLabels = axis.ticks.map((t) => groupThousands(t, axis.decimals));
  const longest = Math.max(...yLabels.map((l) => l.length));

  const plot = {
    left: Math.ceil(longest * LABEL_CHAR_WIDTH) + 8,
    top: PAD_TOP,
    right: width - PAD_RIGHT,
    bottom: height - PAD_BOTTOM,
  };
  const plotWidth = Math.max(1, plot.right - plot.left);
  const plotHeight = Math.max(1, plot.bottom - plot.top);

  const firstMs = points[0].startedAtMs;
  const lastMs = points[points.length - 1].startedAtMs;
  const span = lastMs - firstMs;
  // A single moment sits in the middle; otherwise time maps across the full width.
  const xOf = (ms: number) => (span > 0 ? plot.left + ((ms - firstMs) / span) * plotWidth : plot.left + plotWidth / 2);
  const yOf = (value: number) => plot.bottom - ((value - axis.min) / (axis.max - axis.min)) * plotHeight;

  const spots = points.map((p, i) => ({ x: px(xOf(p.startedAtMs)), y: px(yOf(values[i])) }));
  const path =
    spots.length > 1 ? spots.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x} ${s.y}`).join(' ') : null;
  const markers = spots.length <= MAX_MARKERS ? spots : [];

  return {
    path,
    markers,
    yTicks: axis.ticks.map((t, i) => ({ y: px(yOf(t)), label: yLabels[i] })),
    xTicks: timeTicks(firstMs, lastMs).map((t) => ({ x: px(xOf(t.ms)), label: t.label })),
    plot,
  };
}

/**
 * The one sentence a screen reader hears for a chart (the shapes mean nothing without sight):
 * "Volume per session: 24 sessions from Mar 3, 2026 to Nov 12, 2026, latest 8,400 kg, highest
 * 9,210 kg." A single session reads "…: 1 session on Nov 12, 2026, 8,400 kg." The numbers are the
 * lifter's own, in their unit. Null when there are no points.
 */
export function chartSentence(title: string, points: readonly TrendPoint[], unit: WeightUnit): string | null {
  if (points.length === 0) return null;
  const shown = points.map((p) => displayWeight(p.valueKg, unit));
  const first = points[0];
  const last = points[points.length - 1];
  const latest = `${formatChartWeight(shown[shown.length - 1])} ${unit}`;
  if (points.length === 1) return `${title}: 1 session on ${shortDateLabel(first.startedAtMs)}, ${latest}.`;
  const highest = `${formatChartWeight(Math.max(...shown))} ${unit}`;
  return `${title}: ${points.length} sessions from ${shortDateLabel(first.startedAtMs)} to ${shortDateLabel(
    last.startedAtMs,
  )}, latest ${latest}, highest ${highest}.`;
}
