/**
 * ShareCard — the Strava-style image card of one finished workout (LOG-8, B28), the thing that
 * leaves the app as a picture through the phone's share sheet.
 *
 * What it shows, top to bottom, on Astra's dark background in a 4:5 portrait frame (the shape
 * Instagram and most other apps show without cropping):
 *   - the Astra wordmark and the workout's date;
 *   - the workout's title (or its date when untitled);
 *   - three big numbers: volume (in the sharer's kg / lb unit), sets ("· n warm-up") and
 *     duration — spelled exactly as the analysis screen spells them;
 *   - the session's new PRs (up to three, "+ n more"), each "Squat · 5RM · 225 lb" as the
 *     analysis screen prints it; or, with no PRs, up to three exercises with their set counts, so
 *     a card always says what was done.
 *
 * It states facts, never claims: every number comes from the analysis module (via the screen)
 * and every spelling from `workout/format.ts`. No photos, avatars or network — nothing private
 * beyond what the sharer is choosing to share.
 *
 * What the user can do: nothing — it is a picture. The share-card screen shows it as the preview
 * and captures this very view to an image, so what the lifter sees is exactly what is sent.
 * `ref` (React 19's ref prop) points at the view the screen captures.
 */
import React, { type ComponentRef, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { AnalysisPr } from '@analysis';
import type { WeightUnit } from '@training-math';

import { colors, fonts } from '@/theme';
import {
  countLabel,
  DELETED_EXERCISE,
  formatDuration,
  formatWeight,
  sessionPrLine,
  setsSummaryLabel,
  workoutDateLabel,
} from '@/workout/format';

/** How many PR lines (or, with no PRs, exercise lines) the card lists before "+ n more". */
export const SHARE_CARD_LINE_LIMIT = 3;

/** The card's shape: 4 wide by 5 tall. */
export const SHARE_CARD_ASPECT = 4 / 5;

/** The size of the shared image file, in pixels (1080 × 1350 — 4:5 at a common full-HD width). */
export const SHARE_IMAGE_SIZE = { width: 1080, height: 1350 } as const;

/** The card's sizes are designed for this preview width and scaled from it, so every phone draws the same card. */
const DESIGN_WIDTH = 360;

/** One exercise of the workout, for a card with no PRs. */
export interface ShareCardExercise {
  id: string;
  name: string | null;
  setCount: number;
}

export interface ShareCardProps {
  /** The workout's own title, or null to show its date instead. */
  title: string | null;
  /** When it started (ISO time), for the date line. */
  startedAt: string;
  /** Total working volume in kg (the analysis's number). */
  volumeKg: number;
  /** Every set logged, warm-ups included. */
  totalSets: number;
  /** Sets that weren't warm-ups. */
  workingSets: number;
  /** How long it took, in seconds. */
  durationSeconds: number;
  /** The session's new PRs, as the analysis lists them. */
  prs: readonly AnalysisPr[];
  /** The workout's exercises in order, for a card with no PRs. */
  exercises: readonly ShareCardExercise[];
  /** The sharer's unit. */
  unit: WeightUnit;
  /** How wide the card is drawn on screen; its height follows the 4:5 shape. */
  width: number;
  /** The view the screen captures. */
  ref?: Ref<ComponentRef<typeof View>>;
}

/**
 * The lines under the numbers: the PR lines (capped, "+ n more PRs"), or with no PRs the
 * exercise lines ("Bench Press · 3 sets", capped, "+ n more exercises"). Exported for its tests.
 */
export function shareCardLines(
  prs: readonly AnalysisPr[],
  exercises: readonly ShareCardExercise[],
  unit: WeightUnit,
): { heading: string; lines: string[] } | null {
  if (prs.length > 0) {
    const lines = prs.slice(0, SHARE_CARD_LINE_LIMIT).map((pr) => sessionPrLine(pr, unit));
    const more = prs.length - SHARE_CARD_LINE_LIMIT;
    if (more > 0) lines.push(`+ ${more} more PR${more === 1 ? '' : 's'}`);
    return { heading: prs.length === 1 ? 'New PR' : 'New PRs', lines };
  }
  if (exercises.length === 0) return null;
  const lines = exercises
    .slice(0, SHARE_CARD_LINE_LIMIT)
    .map((e) => `${e.name ?? DELETED_EXERCISE} · ${countLabel(e.setCount, 'set')}`);
  const more = exercises.length - SHARE_CARD_LINE_LIMIT;
  if (more > 0) lines.push(`+ ${more} more exercise${more === 1 ? '' : 's'}`);
  return { heading: 'Exercises', lines };
}

export function ShareCard({
  title,
  startedAt,
  volumeKg,
  totalSets,
  workingSets,
  durationSeconds,
  prs,
  exercises,
  unit,
  width,
  ref,
}: ShareCardProps) {
  // Every size is a design-width size times this, so the card looks the same on every phone.
  const s = width / DESIGN_WIDTH;
  const dateLabel = workoutDateLabel(startedAt);
  const list = shareCardLines(prs, exercises, unit);
  const stats: { label: string; value: string }[] = [
    { label: 'Volume', value: formatWeight(volumeKg, unit) },
    { label: 'Sets', value: setsSummaryLabel(totalSets, workingSets) },
    { label: 'Duration', value: formatDuration(durationSeconds) },
  ];

  return (
    // collapsable={false}: Android must keep this view real for it to be captured.
    <View
      ref={ref}
      collapsable={false}
      testID="share-card"
      style={[styles.frame, { width, height: width / SHARE_CARD_ASPECT, borderRadius: 16 * s }]}
    >
      <LinearGradient colors={[colors.bgMaroon, colors.bg]} style={StyleSheet.absoluteFill} />
      <View style={[styles.inner, { padding: 24 * s }]}>
        <View style={styles.topRow}>
          <Text style={[styles.wordmark, { fontSize: 28 * s, lineHeight: 34 * s }]}>Astra</Text>
          <Text style={[styles.date, { fontSize: 11 * s, lineHeight: 14 * s, letterSpacing: 1.2 * s }]}>{dateLabel}</Text>
        </View>

        <Text style={[styles.title, { fontSize: 24 * s, lineHeight: 30 * s, marginTop: 20 * s }]} numberOfLines={2}>
          {title ?? dateLabel}
        </Text>

        <View style={{ marginTop: 20 * s, gap: 12 * s }}>
          {stats.map((stat) => (
            <View key={stat.label}>
              <Text style={[styles.statLabel, { fontSize: 11 * s, lineHeight: 14 * s, letterSpacing: 1.5 * s }]}>{stat.label}</Text>
              <Text style={[styles.statValue, { fontSize: 26 * s, lineHeight: 32 * s }]} numberOfLines={1}>
                {stat.value}
              </Text>
            </View>
          ))}
        </View>

        {list ? (
          <View style={{ marginTop: 20 * s, gap: 4 * s }}>
            <Text style={[styles.listHeading, { fontSize: 11 * s, lineHeight: 14 * s, letterSpacing: 1.5 * s }]}>
              {list.heading}
            </Text>
            {list.lines.map((line) => (
              <Text key={line} style={[styles.line, { fontSize: 14 * s, lineHeight: 19 * s }]} numberOfLines={1}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      <View style={[styles.stripe, { height: 6 * s }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    // Solid, so the captured image never has see-through corners or a transparent background.
    backgroundColor: colors.bg,
  },
  inner: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    fontFamily: fonts.heading,
    color: colors.text,
  },
  date: {
    fontFamily: fonts.subBold,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fonts.subBold,
    color: colors.text,
  },
  statLabel: {
    fontFamily: fonts.subBold,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: fonts.subBold,
    color: colors.text,
  },
  listHeading: {
    fontFamily: fonts.subBold,
    // Gold (the app's PR highlight), not brand red: red on the maroon band is too low-contrast to read in a feed.
    color: colors.gold,
    textTransform: 'uppercase',
  },
  line: {
    fontFamily: fonts.bodySemiBold,
    color: colors.text,
  },
  stripe: {
    backgroundColor: colors.accent,
  },
});
