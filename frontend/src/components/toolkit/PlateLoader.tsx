/**
 * PlateLoader — the Tool Kit's plate loader (TK-4): "which plates go on each side for 142.5?"
 *
 * What it shows:
 *   - a kg | lb choice of **rack** — plates are real objects, so this screen works in the
 *     rack's unit, not converted weights. It starts in the lifter's display unit and then
 *     remembers the choice; each unit keeps its own rack;
 *   - the target total and the bar's weight, both in the rack's unit;
 *   - the answer from `@training-math`'s exact plate solver: what to put on each side
 *     ("2 × 25 kg"), the total that loads, and in plain words whether that is the target
 *     exactly, short of it (the rack can't make it), or whether the bar alone is already over;
 *   - the rack itself: each plate size with how many are available per side.
 *
 * What the lifter can do: type a target and a bar weight; switch the rack between kg and lb;
 * change how many of each plate there are per side (− / +), take a size off, or add any size
 * (micro-plates included). Rack edits are saved on this phone (`toolkit/plateRack.ts`) and the
 * target is remembered while the app is open.
 *
 * Works with no signal — nothing here leaves the phone.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { loadBar, type WeightUnit } from '@training-math';

import { Button } from '@/components/ui/Button';
import { Body, SectionLabel } from '@/components/ui/Text';
import { readPositiveNumber, readZeroOrMore, type FieldReading } from '@/toolkit/inputs';
import {
  addPlateSize,
  getCachedPlateRacks,
  loadPlateRacks,
  MAX_BAR_WEIGHT,
  MAX_PLATES_PER_SIDE,
  MAX_PLATE_WEIGHT,
  MAX_TARGET_WEIGHT,
  plateSizeProblem,
  removePlateSize,
  savePlateRacks,
  setPlateCount,
  type PlateRackConfig,
  type PlateRacks,
} from '@/toolkit/plateRack';
import { getToolKitSession, updateToolKitSession } from '@/toolkit/session';
import { parseNumberInput } from '@/workout/format';
import { colors, layout, radii, spacing } from '@/theme';

import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { ResultCard } from './ResultCard';
import { NumberField, WeightField } from './WeightField';

const RACK_UNIT_OPTIONS: ChoiceOption<WeightUnit>[] = [
  { value: 'kg', label: 'kg plates', spoken: 'Kilogram plates' },
  { value: 'lb', label: 'lb plates', spoken: 'Pound plates' },
];

/** A plate-rack number as text: 2.5 → "2.5", 20 → "20". */
const plateText = (value: number): string => String(value);

/** Reads the bar box: 0 is allowed (plates on a pin or landmine), up to `MAX_BAR_WEIGHT`. */
const readBar = (text: string): FieldReading => readZeroOrMore(text, MAX_BAR_WEIGHT, 'a bar weight');

interface PlateLoaderProps {
  /** The lifter's display unit — which rack to show the first time this screen is used. */
  displayUnit: WeightUnit;
}

export function PlateLoader({ displayUnit }: PlateLoaderProps) {
  // The saved racks: from memory straight away when already read this session, else loaded.
  const [racks, setRacks] = useState<PlateRacks | null>(getCachedPlateRacks);
  const [target, setTarget] = useState(() => getToolKitSession().plates.target);
  const [barText, setBarText] = useState<string | null>(null);
  const [newPlate, setNewPlate] = useState('');
  const [newPlateError, setNewPlateError] = useState<string | null>(null);

  useEffect(() => {
    if (racks) return;
    let cancelled = false;
    void loadPlateRacks().then((loaded) => {
      if (!cancelled) setRacks(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [racks]);

  const unit: WeightUnit = racks?.unit ?? displayUnit;
  const rack: PlateRackConfig | null = racks ? racks[unit] : null;
  // The bar box shows the saved bar until the lifter types in it.
  const barValue = barText ?? (rack ? plateText(rack.barWeight) : '');

  const targetReading = readPositiveNumber(target, MAX_TARGET_WEIGHT, 'a target weight');
  const barReading = readBar(barValue);
  const targetValue = targetReading.kind === 'ok' ? targetReading.value : null;
  const barWeight = barReading.kind === 'ok' ? barReading.value : null;
  // The solver works through every per-side weight up to the target, so it only re-runs when
  // the numbers or the rack actually change, not on every redraw.
  const load = useMemo(() => {
    if (!rack || targetValue === null || barWeight === null) return null;
    return loadBar(targetValue, barWeight, rack.plates);
  }, [rack, targetValue, barWeight]);

  if (!racks || !rack) {
    return <Body variant="muted">Loading your plate rack…</Body>;
  }

  /** Saves a change to the rack showing now (in memory at once, on the phone in the background). */
  function changeRack(next: PlateRackConfig): void {
    if (!racks) return;
    const updated: PlateRacks = { ...racks, unit, [unit]: next };
    setRacks(updated);
    savePlateRacks(updated);
  }

  /** Switches to the other unit's rack, remembering the choice. */
  function chooseUnit(next: WeightUnit): void {
    if (!racks || next === unit) return;
    const updated: PlateRacks = { ...racks, unit: next };
    setRacks(updated);
    savePlateRacks(updated);
    setBarText(null);
    setNewPlateError(null);
  }

  /** Reads the bar box as the lifter types, saving the bar weight whenever it is usable. */
  function changeBar(text: string): void {
    setBarText(text);
    const reading = readBar(text);
    if (reading.kind === 'ok' && rack) changeRack({ ...rack, barWeight: reading.value });
  }

  /** Adds the typed plate size to the rack, or says why it can't. */
  function addPlate(): void {
    if (!rack) return;
    const parsed = parseNumberInput(newPlate);
    if (!parsed.ok || parsed.value === null) {
      setNewPlateError('Enter a plate weight as a number.');
      return;
    }
    const problem = plateSizeProblem(rack, parsed.value);
    if (problem) {
      setNewPlateError(problem);
      return;
    }
    changeRack(addPlateSize(rack, parsed.value));
    setNewPlate('');
    setNewPlateError(null);
  }

  return (
    <View style={styles.root}>
      <ChoiceChips options={RACK_UNIT_OPTIONS} selected={unit} onSelect={chooseUnit} fill />
      <WeightField
        label="Target"
        unit={unit}
        value={target}
        onChangeText={(text) => {
          setTarget(text);
          updateToolKitSession('plates', { target: text });
        }}
        error={targetReading.kind === 'invalid' ? targetReading.message : null}
      />
      <WeightField
        label="Bar"
        unit={unit}
        value={barValue}
        onChangeText={changeBar}
        error={barReading.kind === 'invalid' ? barReading.message : null}
      />

      <ResultCard
        label="The bar loads"
        value={load === null ? null : `${plateText(load.loaded)} ${unit}`}
        hint={targetValue === null ? 'Enter a target weight.' : 'Enter the bar’s weight.'}
        secondary={
          load === null
            ? null
            : load.remainder === 0
              ? 'Exactly the target.'
              : load.remainder > 0
                ? `Short by ${plateText(load.remainder)} ${unit} — this rack can’t make the target.`
                : 'The bar alone is over the target.'
        }
      >
        {load !== null ? (
          <View style={styles.perSide}>
            <SectionLabel size="small">Each side</SectionLabel>
            {load.perSide.length === 0 ? (
              <Body>Just the bar — no plates.</Body>
            ) : (
              load.perSide.map((line) => (
                <Body key={line.plate} style={styles.perSideLine}>
                  {line.count} × {plateText(line.plate)} {unit}
                </Body>
              ))
            )}
          </View>
        ) : null}
      </ResultCard>

      <View style={styles.group}>
        <SectionLabel>Your rack ({unit}, per side)</SectionLabel>
        {rack.plates.length === 0 ? <Body variant="muted">No plates on this rack yet — add a size below.</Body> : null}
        {rack.plates.map((item) => {
          const name = `${plateText(item.plate)} ${unit}`;
          return (
            <View key={item.plate} style={styles.plateRow}>
              <Body style={styles.plateName}>{name}</Body>
              <StepButton
                symbol="−"
                label={`Fewer ${name} plates`}
                disabled={item.perSide === 0}
                onPress={() => changeRack(setPlateCount(rack, item.plate, item.perSide - 1))}
              />
              <Body style={styles.count}>{item.perSide}</Body>
              <StepButton
                symbol="+"
                label={`More ${name} plates`}
                disabled={item.perSide >= MAX_PLATES_PER_SIDE}
                onPress={() => changeRack(setPlateCount(rack, item.plate, item.perSide + 1))}
              />
              <StepButton
                symbol="×"
                label={`Remove ${name} plates`}
                onPress={() => changeRack(removePlateSize(rack, item.plate))}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.group}>
        <NumberField
          label={`Add a plate size (${unit})`}
          decimal
          value={newPlate}
          onChangeText={(text) => {
            setNewPlate(text);
            setNewPlateError(null);
          }}
          error={newPlateError}
          placeholder={`Up to ${MAX_PLATE_WEIGHT}`}
        />
        <Button label="Add plate" variant="outline" onPress={addPlate} />
      </View>
    </View>
  );
}

interface StepButtonProps {
  symbol: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

/** A small square button for the rack rows (−, +, ×). */
function StepButton({ symbol, label, onPress, disabled = false }: StepButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.step, pressed && styles.stepPressed, disabled && styles.stepDisabled]}
    >
      <Body>{symbol}</Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
  },
  perSide: {
    gap: spacing.xs,
  },
  perSideLine: {
    color: colors.text,
  },
  plateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  plateName: {
    flex: 1,
  },
  count: {
    minWidth: 28,
    textAlign: 'center',
  },
  step: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceDeep,
  },
  stepPressed: {
    backgroundColor: colors.accentDim,
  },
  stepDisabled: {
    opacity: 0.4,
  },
});
