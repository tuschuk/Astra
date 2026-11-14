/**
 * Tab layout — mounts expo-router's headless tabs with the custom AstraTabBar
 * (FND-4: five bottom tabs with Workout dead center, no iOS "More" overflow)
 * plus the floating top-right ProfileButton that reaches the You screen.
 * The destinations themselves are defined once in AstraTabBar's TABS config;
 * this layout just provides the screen area above the bar.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { Tabs, TabSlot } from 'expo-router/ui';

import { AstraTabBar } from '@/components/AstraTabBar';
import { ProfileButton } from '@/components/ProfileButton';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs style={styles.root}>
      <TabSlot style={styles.scene} />
      <ProfileButton />
      <AstraTabBar />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scene: {
    flex: 1,
  },
});
