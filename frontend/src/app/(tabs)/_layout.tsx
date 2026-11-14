/**
 * Tab layout — mounts expo-router's headless tabs with the custom AstraTabBar
 * (FND-4: all six destinations on both platforms, no iOS "More" overflow).
 * The destinations themselves are defined once in AstraTabBar's TABS config;
 * this layout just provides the screen area above the bar.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { Tabs, TabSlot } from 'expo-router/ui';

import { AstraTabBar } from '@/components/AstraTabBar';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs style={styles.root}>
      <TabSlot style={styles.scene} />
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
