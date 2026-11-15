/**
 * Tests for the plate loader (TK-4): per-side answers from the module's solver for the default
 * racks, rack edits changing the answer (and being saved), the shortfall and bar-too-heavy
 * states, custom micro-plates, and the kg | lb rack toggle keeping each unit's rack.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import KeyValueStore from 'expo-sqlite/kv-store';

import { getCachedPlateRacks, PLATE_RACK_KEY, resetPlateRackCache } from '@/toolkit/plateRack';
import { resetToolKitSession } from '@/toolkit/session';

import { PlateLoader } from './PlateLoader';

afterEach(async () => {
  resetToolKitSession();
  resetPlateRackCache();
  // jest.setup.js's stand-in key-value store lives for the whole file: start each test bare.
  await KeyValueStore.removeItem(PLATE_RACK_KEY);
});

/** Renders the loader and waits for the rack to load. */
async function renderLoader(displayUnit: 'kg' | 'lb' = 'lb') {
  const view = await render(<PlateLoader displayUnit={displayUnit} />);
  await screen.findByText(`Your rack (${displayUnit}, per side)`);
  return view;
}

describe('PlateLoader', () => {
  it('default lb rack, 225 on a 45 lb bar → 2 × 45 lb per side, exactly', async () => {
    await renderLoader('lb');
    await fireEvent.changeText(screen.getByLabelText('Target (lb)'), '225');
    expect(screen.getByText('2 × 45 lb')).toBeTruthy();
    expect(screen.getByLabelText('The bar loads: 225 lb. Exactly the target.')).toBeTruthy();
    expect(screen.getByText('Exactly the target.')).toBeTruthy();
  });

  it('starts on the display unit’s rack: 100 kg on a 20 kg bar', async () => {
    await renderLoader('kg');
    await fireEvent.changeText(screen.getByLabelText('Target (kg)'), '100');
    expect(screen.getByText('1 × 25 kg')).toBeTruthy();
    expect(screen.getByText('1 × 15 kg')).toBeTruthy();
    expect(screen.getByLabelText('The bar loads: 100 kg. Exactly the target.')).toBeTruthy();
  });

  it('editing the rack changes the answer, and the edit is saved', async () => {
    await renderLoader('lb');
    await fireEvent.changeText(screen.getByLabelText('Target (lb)'), '225');
    // Take the 45s down to one per side: 225 now needs 45 + 35 + 10 per side.
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByLabelText('Fewer 45 lb plates'));
    expect(screen.getByText('1 × 45 lb')).toBeTruthy();
    expect(screen.getByText('1 × 35 lb')).toBeTruthy();
    expect(screen.getByText('1 × 10 lb')).toBeTruthy();
    expect(getCachedPlateRacks()?.lb.plates[0]).toEqual({ plate: 45, perSide: 1 });
  });

  it('says how short the rack falls when it can’t make the target', async () => {
    await renderLoader('lb');
    // Default lb rack holds 267.5 per side: 45 + 2 × 267.5 = 580.
    await fireEvent.changeText(screen.getByLabelText('Target (lb)'), '700');
    expect(screen.getByLabelText('The bar loads: 580 lb', { exact: false })).toBeTruthy();
    expect(screen.getByText('Short by 120 lb — this rack can’t make the target.')).toBeTruthy();
  });

  it('says when the bar alone is over the target', async () => {
    await renderLoader('lb');
    await fireEvent.changeText(screen.getByLabelText('Target (lb)'), '35');
    expect(screen.getByText('The bar alone is over the target.')).toBeTruthy();
    expect(screen.getByText('Just the bar — no plates.')).toBeTruthy();
  });

  it('uses the bar weight typed, and refuses a silly one', async () => {
    await renderLoader('kg');
    await fireEvent.changeText(screen.getByLabelText('Bar (kg)'), '15');
    await fireEvent.changeText(screen.getByLabelText('Target (kg)'), '20');
    expect(screen.getByText('1 × 2.5 kg')).toBeTruthy();
    expect(getCachedPlateRacks()?.kg.barWeight).toBe(15);
    await fireEvent.changeText(screen.getByLabelText('Bar (kg)'), '500');
    expect(screen.getByText('Enter a bar weight up to 100.')).toBeTruthy();
    expect(getCachedPlateRacks()?.kg.barWeight).toBe(15);
    // A cleared bar box asks for the bar, not the target that is already there.
    await fireEvent.changeText(screen.getByLabelText('Bar (kg)'), '');
    expect(screen.getByText('Enter the bar’s weight.')).toBeTruthy();
  });

  it('adds a custom micro-plate the solver then uses', async () => {
    await renderLoader('kg');
    await fireEvent.changeText(screen.getByLabelText('Add a plate size (kg)'), '0,5');
    await fireEvent.press(screen.getByLabelText('Add plate'));
    expect(screen.getByText('0.5 kg')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Target (kg)'), '21');
    expect(screen.getByText('1 × 0.5 kg')).toBeTruthy();
    expect(screen.getByText('Exactly the target.')).toBeTruthy();
  });

  it('refuses a duplicate plate size inline', async () => {
    await renderLoader('kg');
    await fireEvent.changeText(screen.getByLabelText('Add a plate size (kg)'), '25');
    await fireEvent.press(screen.getByLabelText('Add plate'));
    expect(screen.getByText('That plate is already on the rack.')).toBeTruthy();
  });

  it('removes a plate size', async () => {
    await renderLoader('kg');
    await fireEvent.press(screen.getByLabelText('Remove 15 kg plates'));
    expect(screen.queryByLabelText('Remove 15 kg plates')).toBeNull();
  });

  it('switching to the kg rack keeps the lb rack’s edits, and the choice is remembered', async () => {
    const first = await renderLoader('lb');
    await fireEvent.press(screen.getByLabelText('Fewer 45 lb plates'));
    await fireEvent.press(screen.getByLabelText('Kilogram plates'));
    expect(screen.getByText('Your rack (kg, per side)')).toBeTruthy();
    expect(screen.getByLabelText('Bar (kg)').props.value).toBe('20');
    await first.unmount();
    // Reopened with the display unit still lb: the kg rack shows, as last chosen.
    await render(<PlateLoader displayUnit="lb" />);
    expect(screen.getByText('Your rack (kg, per side)')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Pound plates'));
    expect(getCachedPlateRacks()?.lb.plates[0]).toEqual({ plate: 45, perSide: 3 });
  });
});
