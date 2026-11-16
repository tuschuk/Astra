/**
 * TrendChart — one line chart of a lifter's sessions over time (B46): the Volume chart and the
 * estimated-1RM chart on the profile's Trends tab are both this component.
 *
 * What it shows: a line through one dot per session (oldest left, newest right, spaced by date),
 * faint guide lines at round values with their labels on the left in the lifter's kg / lb unit,
 * and a few dates along the bottom. A single session is a lone dot.
 *
 * What the user can do: just look; it has no controls. A screen reader hears one sentence with
 * the real numbers — how many sessions, from when to when, the latest and the highest — because
 * the shapes alone mean nothing without sight (the MuscleMap pattern).
 *
 * How it draws: all the geometry comes from `buildChartLayout` (pure, tested); this file only
 * turns that plan into `react-native-svg` shapes. It measures its own width with `onLayout` and
 * draws nothing until it knows it, so no zero-width sum ever reaches the geometry.
 */
import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import type { WeightUnit } from '@training-math';

import { colors, fonts } from '@/theme';
import type { TrendPoint } from '@/workout/trendSeries';

import { buildChartLayout, chartSentence, type ChartBaseline } from './chartLayout';

/** The chart's drawn height; the width is whatever the screen gives it. */
export const TREND_CHART_HEIGHT = 180;

interface TrendChartProps {
  /** What the chart is of, as the screen reader's sentence starts: "Volume per session". */
  title: string;
  /** The sessions to draw, oldest first, values in kg. */
  points: readonly TrendPoint[];
  unit: WeightUnit;
  /** 'zero' anchors the value axis at 0 (volume); 'fit' fits it to the data (e1RM). */
  baseline: ChartBaseline;
  testID?: string;
}

export function TrendChart({ title, points, unit, baseline, testID }: TrendChartProps) {
  const [width, setWidth] = useState(0);
  const layout = buildChartLayout(points, { width, height: TREND_CHART_HEIGHT, unit, baseline });

  function onLayout(event: LayoutChangeEvent) {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  }

  return (
    <View
      style={styles.frame}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={chartSentence(title, points, unit) ?? `${title}: no sessions yet.`}
      testID={testID}
    >
      {layout ? (
        <Svg
          width={width}
          height={TREND_CHART_HEIGHT}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {layout.yTicks.map((tick) => (
            <React.Fragment key={`y:${tick.label}`}>
              <Line
                x1={layout.plot.left}
                x2={layout.plot.right}
                y1={tick.y}
                y2={tick.y}
                stroke={colors.border}
                strokeWidth={1}
              />
              <SvgText
                x={layout.plot.left - 6}
                y={tick.y + 3}
                fill={colors.muted}
                fontSize={10}
                fontFamily={fonts.sub}
                textAnchor="end"
              >
                {tick.label}
              </SvgText>
            </React.Fragment>
          ))}
          {layout.xTicks.map((tick, i) => (
            <SvgText
              key={`x:${tick.label}`}
              x={tick.x}
              y={TREND_CHART_HEIGHT - 6}
              fill={colors.muted}
              fontSize={10}
              fontFamily={fonts.sub}
              // The first and last labels hug the plot's edges so they never run off the chart.
              textAnchor={layout.xTicks.length === 1 ? 'middle' : i === 0 ? 'start' : i === layout.xTicks.length - 1 ? 'end' : 'middle'}
            >
              {tick.label}
            </SvgText>
          ))}
          {layout.path ? (
            <Path
              testID="trend-line"
              d={layout.path}
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          ) : null}
          {layout.markers.map((spot, i) => (
            <Circle key={`m:${i}`} testID="trend-marker" cx={spot.x} cy={spot.y} r={3} fill={colors.accentBright} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: TREND_CHART_HEIGHT,
    alignSelf: 'stretch',
  },
});
