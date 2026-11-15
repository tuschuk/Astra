/**
 * ToolKitSheet — the Tool Kit: four training calculators and a workout timer in one full-screen
 * panel that slides up over whatever the lifter was doing.
 *
 * What it shows: a "Tool Kit" header with a Close button, a five-way switcher — 1RM | RPE |
 * %1RM | Plates | Timer — and the chosen tool below it (TK-1..TK-5). Every calculator number
 * comes from `@training-math`; weights are typed and shown in the lifter's display unit, except
 * on the plate loader, which works in its rack's unit (see PlateLoader). The timer (TimerScreen)
 * keeps running when the panel closes — it lives in `toolkit/timerStore.ts`, not in the panel.
 *
 * What the lifter can do: switch tools, use them, and close the panel (Close, or the system
 * back button). It is opened from two places — the floating Tool Kit button in the active
 * workout (one tap from any point in the workout) and the Workout tab's tiles (which open it
 * straight at that tool via `initialTool`).
 *
 * Why a panel over the screen and not a screen of its own: the logger stays exactly where it
 * was underneath — scroll position, half-typed reps and all — so closing the Tool Kit loses
 * nothing. The panel itself forgets its contents each time it closes (that is how React
 * Native's `Modal` works), so the calculators keep what was typed in `toolkit/session.ts`
 * and the plate rack in `toolkit/plateRack.ts`.
 *
 * Fully offline: nothing in here talks to the network.
 */
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Text';
import { useDisplayUnit } from '@/settings/displayUnit';
import { getToolKitSession, setToolKitTool, type ToolId } from '@/toolkit/session';
import { colors, layout, spacing } from '@/theme';

import { ChoiceChips, type ChoiceOption } from './ChoiceChips';
import { IntensityCalculator } from './IntensityCalculator';
import { OneRmCalculator } from './OneRmCalculator';
import { PlateLoader } from './PlateLoader';
import { RpeCalculator } from './RpeCalculator';
import { TimerScreen } from './TimerScreen';

/** The switcher's five options, in order, with what a screen reader says for each. */
export const TOOL_OPTIONS: readonly ChoiceOption<ToolId>[] = [
  { value: 'oneRm', label: '1RM', spoken: '1RM calculator' },
  { value: 'rpe', label: 'RPE', spoken: 'RPE calculator' },
  { value: 'percent', label: '%1RM', spoken: 'Intensity calculator' },
  { value: 'plates', label: 'Plates', spoken: 'Plate loader' },
  { value: 'timer', label: 'Timer', spoken: 'Timer' },
];

interface ToolKitSheetProps {
  /** Whether the panel is open. */
  visible: boolean;
  /** Called when the lifter closes it. */
  onClose: () => void;
  /** The tool to open on; without it, the one last used this session. */
  initialTool?: ToolId;
}

export function ToolKitSheet({ visible, onClose, initialTool }: ToolKitSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      {/* Mounted fresh on every open, so it picks up `initialTool` and the session each time. */}
      <SheetBody onClose={onClose} initialTool={initialTool} />
    </Modal>
  );
}

/** The panel's contents: header, switcher and the chosen tool. */
function SheetBody({ onClose, initialTool }: Omit<ToolKitSheetProps, 'visible'>) {
  const insets = useSafeAreaInsets();
  const unit = useDisplayUnit();
  const [tool, setTool] = useState<ToolId>(() => initialTool ?? getToolKitSession().tool);

  // Whatever is showing — the tool opened at, or one switched to — is where the next open starts.
  useEffect(() => {
    setToolKitTool(tool);
  }, [tool]);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.header}>
          <Heading size="section">Tool Kit</Heading>
          <Button label="Close" variant="ghost" onPress={onClose} />
        </View>
        <ChoiceChips options={TOOL_OPTIONS} selected={tool} onSelect={setTool} fill />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {tool === 'oneRm' ? <OneRmCalculator unit={unit} /> : null}
        {tool === 'rpe' ? <RpeCalculator unit={unit} /> : null}
        {tool === 'percent' ? <IntensityCalculator unit={unit} /> : null}
        {tool === 'plates' ? <PlateLoader displayUnit={unit} /> : null}
        {tool === 'timer' ? <TimerScreen /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  top: {
    paddingHorizontal: layout.screenPadding,
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.sm,
  },
});
