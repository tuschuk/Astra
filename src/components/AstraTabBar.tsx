/**
 * AstraTabBar — the custom bottom tab bar (build-list item FND-4).
 *
 * Why custom: the native iOS tab bar overflows a sixth destination into a
 * "More" menu. Built on expo-router's headless tabs (TabList/TabTrigger),
 * this bar renders all six destinations on both platforms:
 * Home · Market · [Workout] · Groups · Library · You, with Workout as the
 * elevated red circular action in the center — the app's single boldest
 * element, per the design plan.
 *
 * Styling follows the nav recipe in docs/styling_guide.md: pure black bar,
 * red hairline top border, uppercase tracked labels, accent color on the
 * active item, red glow on the center action.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabList, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Ionicons } from '@expo/vector-icons';

import { colors, glows, layout, radii, spacing, type } from '@/theme';

/** One tab's static config: route name, destination, label and icon pair. */
export interface TabConfig {
  /** Route name registered with the tab navigator. */
  name: string;
  /** Destination path for the trigger. */
  href: string;
  /** Short label under the icon (space is tight with six tabs). */
  label: string;
  /** Ionicons name when idle. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Ionicons name when this tab is active (the filled variant). */
  iconActive: keyof typeof Ionicons.glyphMap;
}

/**
 * The six destinations in display order (FND-4). `index` is the Home route
 * (expo-router's name for src/app/(tabs)/index.tsx). Workout sits center.
 */
export const TABS: readonly TabConfig[] = [
  { name: 'index', href: '/', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  {
    name: 'marketplace',
    href: '/marketplace',
    label: 'Market',
    icon: 'storefront-outline',
    iconActive: 'storefront',
  },
  {
    name: 'workout',
    href: '/workout',
    label: 'Workout',
    icon: 'barbell-outline',
    iconActive: 'barbell',
  },
  {
    name: 'communities',
    href: '/communities',
    label: 'Groups',
    icon: 'people-outline',
    iconActive: 'people',
  },
  { name: 'library', href: '/library', label: 'Library', icon: 'book-outline', iconActive: 'book' },
  { name: 'you', href: '/you', label: 'You', icon: 'person-outline', iconActive: 'person' },
] as const;

type TabButtonProps = TabTriggerSlotProps & {
  tab: TabConfig;
};

/**
 * A single tab button. Rendered as the child of a `TabTrigger asChild`, so
 * expo-router injects the press handlers, ref and `isFocused`; this component
 * only decides how the tab looks in each state. The Workout tab renders as
 * the raised red circle; the other five are icon-over-label items.
 */
export function AstraTabButton({ tab, isFocused = false, ref, ...pressableProps }: TabButtonProps) {
  const isCenter = tab.name === 'workout';

  return (
    <Pressable
      // expo-router's TabTriggerSlotProps still types the ref against the
      // pre-RN-0.88 View class; the runtime object is the same host ref.
      ref={ref as React.ComponentProps<typeof Pressable>['ref']}
      {...pressableProps}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isFocused }}
      testID={`tab-${tab.name}`}
      style={isCenter ? styles.centerSlot : styles.item}
    >
      {isCenter ? (
        // No text label on the center action (plan decision: the red circle
        // is the label); screen readers get it from accessibilityLabel.
        <View style={[styles.centerButton, glows.accent, isFocused && styles.centerButtonFocused]}>
          <Ionicons name={isFocused ? tab.iconActive : tab.icon} size={26} color={colors.text} />
        </View>
      ) : (
        <>
          <Ionicons
            name={isFocused ? tab.iconActive : tab.icon}
            size={22}
            color={isFocused ? colors.accent : colors.muted}
          />
          <Text style={[type.labelSmall, styles.label, isFocused && styles.labelFocused]}>
            {tab.label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The bar itself: a black TabList with one trigger per destination.
 * Rendered below the TabSlot in src/app/(tabs)/_layout.tsx.
 */
export function AstraTabBar() {
  const insets = useSafeAreaInsets();

  return (
    <TabList asChild>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
            <AstraTabButton tab={tab} />
          </TabTrigger>
        ))}
      </View>
    </TabList>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.navBg,
    borderTopWidth: 1,
    borderTopColor: colors.navBorder,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: layout.minTouchTarget,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xs,
  },
  // The center slot stays inside the bar's bounds: Android does not
  // hit-test children outside their parent, so a negative-margin "raise"
  // would make the top of the button dead to touches. The 56px circle is
  // taller than its neighbors, which gives the raised read on its own.
  centerSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: spacing.xs,
  },
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: radii.round,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.navBg,
  },
  centerButtonFocused: {
    backgroundColor: colors.accentBright,
    borderColor: colors.text,
  },
  label: {
    color: colors.muted,
  },
  labelFocused: {
    color: colors.accent,
  },
});
