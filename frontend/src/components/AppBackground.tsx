/**
 * AppBackground — Astra's signature page texture, rendered behind every screen.
 *
 * Two static layers (from docs/styling_guide.md):
 * 1. A vertical black → maroon → black band gradient, so screens aren't flat black.
 * 2. A faint red 60px grid, drawn once as an SVG pattern (a single static draw —
 *    no re-renders, no per-cell views).
 *
 * It fills its parent absolutely; wrap screen content in <Screen>, which
 * mounts this underneath. Pure decoration, hidden from accessibility.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { colors, layout } from '@/theme';

function AppBackgroundInner() {
  return (
    <View
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <LinearGradient
        colors={[colors.bg, colors.bgMaroon, colors.bg, colors.bgMaroon, colors.bg]}
        locations={[0, 0.25, 0.5, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <Pattern
            id="astra-grid"
            width={layout.gridCell}
            height={layout.gridCell}
            patternUnits="userSpaceOnUse"
          >
            <Line
              x1={0}
              y1={0}
              x2={layout.gridCell}
              y2={0}
              stroke={colors.gridLine}
              strokeWidth={1}
            />
            <Line
              x1={0}
              y1={0}
              x2={0}
              y2={layout.gridCell}
              stroke={colors.gridLine}
              strokeWidth={1}
            />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#astra-grid)" />
      </Svg>
    </View>
  );
}

/** Memoized: the background never changes, so it never re-renders. */
export const AppBackground = React.memo(AppBackgroundInner);
