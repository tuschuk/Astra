/**
 * ProfileButton — the floating avatar control pinned to the top-right of
 * every tab screen. It is the way to the You/profile destination now that
 * the bottom bar holds five tabs with Workout dead center.
 *
 * Rendered inside the Tabs navigator (it needs the tabs context): a
 * TabTrigger referencing the `you` route by name, drawn as a circular
 * surface chip with the person icon. Turns accent-red when the profile
 * is the active screen.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Ionicons } from '@expo/vector-icons';

import { colors, glows, layout, radii } from '@/theme';

import { YOU_TAB } from './AstraTabBar';

const BUTTON_SIZE = 44;

function ProfileCircle({ isFocused = false, ref, ...pressableProps }: TabTriggerSlotProps) {
  return (
    <Pressable
      // Same stale-typing cast as AstraTabButton: expo-router types the ref
      // against the pre-RN-0.88 View class; the runtime object is identical.
      ref={ref as React.ComponentProps<typeof Pressable>['ref']}
      {...pressableProps}
      accessibilityRole="tab"
      accessibilityLabel={YOU_TAB.label}
      accessibilityState={{ selected: isFocused }}
      testID="tab-you"
      android_ripple={{ color: colors.accentDim, borderless: true }}
      style={({ pressed }) => [styles.circle, isFocused && styles.circleFocused, pressed && styles.pressed]}
    >
      <Ionicons
        name={isFocused ? YOU_TAB.iconActive : YOU_TAB.icon}
        size={20}
        color={isFocused ? colors.accent : colors.muted}
      />
    </Pressable>
  );
}

export function ProfileButton() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.anchor, { top: insets.top + 8 }]} pointerEvents="box-none">
      <TabTrigger name={YOU_TAB.name} asChild>
        <ProfileCircle />
      </TabTrigger>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    right: layout.screenPadding,
    zIndex: 10,
  },
  circle: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radii.round,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleFocused: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
    ...glows.accentSm,
  },
  pressed: {
    opacity: 0.7,
  },
});
