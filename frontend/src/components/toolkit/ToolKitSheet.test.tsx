/**
 * Tests for the Tool Kit panel: the switcher shows each calculator and the timer, the panel
 * opens on the tool asked for (or the one last used), Close reports, and the weight calculators
 * follow the lifter's display unit.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { unitStore } from '@/settings/unitStore';
import { resetPlateRackCache } from '@/toolkit/plateRack';
import { resetToolKitSession, type ToolId } from '@/toolkit/session';
import { resetTimerStore } from '@/toolkit/timerStore';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import { ToolKitSheet } from './ToolKitSheet';

afterEach(() => {
  resetTimerStore();
  resetToolKitSession();
  resetPlateRackCache();
  unitStore.reset();
});

/** Renders the panel (open unless told otherwise) with a spy Close handler. */
async function renderSheet(props: { visible?: boolean; initialTool?: ToolId } = {}) {
  const onClose = jest.fn<() => void>();
  const view = await render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <ToolKitSheet visible={props.visible ?? true} onClose={onClose} initialTool={props.initialTool} />
    </SafeAreaProvider>,
  );
  return { onClose, view };
}

describe('ToolKitSheet', () => {
  it('opens on the 1RM calculator and switches between all five tools', async () => {
    await renderSheet();
    expect(screen.getByText('Tool Kit')).toBeTruthy();
    expect(screen.getByLabelText('Reps')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('RPE calculator'));
    expect(screen.getByText('Target reps')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Intensity calculator'));
    expect(screen.getByLabelText('Percent of 1RM (%)')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Plate loader'));
    expect(await screen.findByLabelText('Add plate')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Timer'));
    expect(screen.getByLabelText('Time left: 2:00')).toBeTruthy();
  });

  it('opens straight at the tool asked for', async () => {
    await renderSheet({ initialTool: 'percent' });
    expect(screen.getByLabelText('Intensity calculator').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('reopens on the tool last used', async () => {
    const { view } = await renderSheet();
    await fireEvent.press(screen.getByLabelText('RPE calculator'));
    await view.unmount();
    await renderSheet();
    expect(screen.getByText('Target reps')).toBeTruthy();
  });

  it('Close reports, and a closed panel shows nothing', async () => {
    const { onClose, view } = await renderSheet();
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
    await renderSheet({ visible: false });
    expect(screen.queryByText('Tool Kit')).toBeNull();
  });

  it('weights are typed in the display unit (lb by default)', async () => {
    await renderSheet();
    expect(screen.getByLabelText('Weight (lb)')).toBeTruthy();
  });
});
