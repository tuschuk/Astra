/**
 * Tests for the plate rack: saving and reading back through a stand-in key-value store,
 * damaged or missing saves falling back to the defaults (per unit), and the rack edits.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  addPlateSize,
  DEFAULT_PLATE_RACKS,
  getCachedPlateRacks,
  loadPlateRacks,
  MAX_PLATE_SIZES,
  MAX_PLATES_PER_SIDE,
  parsePlateRacks,
  PLATE_RACK_KEY,
  plateSizeProblem,
  removePlateSize,
  resetPlateRackCache,
  savePlateRacks,
  serializePlateRacks,
  setPlateCount,
  type PlateRacks,
  type RackStorage,
} from './plateRack';

/** An in-memory stand-in for expo-sqlite's key-value store. */
function fakeStorage(initial: Record<string, string> = {}): RackStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
  };
}

const EDITED: PlateRacks = {
  unit: 'kg',
  kg: { barWeight: 15, plates: [{ plate: 20, perSide: 3 }, { plate: 0.5, perSide: 2 }] },
  lb: DEFAULT_PLATE_RACKS.lb,
};

afterEach(() => {
  resetPlateRackCache();
  jest.restoreAllMocks();
});

describe('saving and loading', () => {
  it('a new phone gets the default racks', async () => {
    expect(await loadPlateRacks(fakeStorage())).toEqual(DEFAULT_PLATE_RACKS);
  });

  it('round-trips an edited rack through storage', async () => {
    const storage = fakeStorage();
    savePlateRacks(EDITED, storage);
    await Promise.resolve();
    expect(storage.items.get(PLATE_RACK_KEY)).toBe(serializePlateRacks(EDITED));
    resetPlateRackCache();
    expect(await loadPlateRacks(storage)).toEqual(EDITED);
  });

  it('keeps what was saved in memory, so a reopen needs no storage read', async () => {
    savePlateRacks(EDITED, fakeStorage());
    expect(getCachedPlateRacks()).toEqual(EDITED);
    const storage = fakeStorage();
    const read = jest.spyOn(storage, 'getItem');
    expect(await loadPlateRacks(storage)).toEqual(EDITED);
    expect(read).not.toHaveBeenCalled();
  });

  it('shrugs off a storage that can’t be read or written', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: RackStorage = {
      getItem: () => Promise.reject(new Error('disk')),
      setItem: () => Promise.reject(new Error('disk')),
    };
    expect(await loadPlateRacks(broken)).toEqual(DEFAULT_PLATE_RACKS);
    savePlateRacks(EDITED, broken);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getCachedPlateRacks()).toEqual(EDITED); // still works for this session
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe('parsePlateRacks', () => {
  it('falls back to the defaults for missing, garbled or wrong-version saves', () => {
    expect(parsePlateRacks(null)).toEqual(DEFAULT_PLATE_RACKS);
    expect(parsePlateRacks('{not json')).toEqual(DEFAULT_PLATE_RACKS);
    expect(parsePlateRacks('42')).toEqual(DEFAULT_PLATE_RACKS);
    expect(parsePlateRacks(JSON.stringify({ ...EDITED, version: 99 }))).toEqual(DEFAULT_PLATE_RACKS);
  });

  it('replaces only the damaged unit’s rack, keeping the other', () => {
    const json = JSON.stringify({ version: 1, unit: 'kg', kg: EDITED.kg, lb: { barWeight: -1, plates: [] } });
    expect(parsePlateRacks(json)).toEqual({ unit: 'kg', kg: EDITED.kg, lb: DEFAULT_PLATE_RACKS.lb });
  });

  it.each([
    ['a fractional count', [{ plate: 20, perSide: 1.5 }]],
    ['a negative count', [{ plate: 20, perSide: -1 }]],
    ['too many per side', [{ plate: 20, perSide: MAX_PLATES_PER_SIDE + 1 }]],
    ['a zero plate', [{ plate: 0, perSide: 1 }]],
    ['a duplicate size', [{ plate: 20, perSide: 1 }, { plate: 20, perSide: 2 }]],
    ['a non-object plate', ['20']],
  ])('refuses a rack with %s', (_, plates) => {
    const json = JSON.stringify({ version: 1, unit: null, kg: { barWeight: 20, plates }, lb: EDITED.kg });
    expect(parsePlateRacks(json).kg).toEqual(DEFAULT_PLATE_RACKS.kg);
  });

  it('drops an unknown unit to “follow the display unit” and sorts plates heaviest first', () => {
    const json = JSON.stringify({
      version: 1,
      unit: 'stone',
      kg: { barWeight: 20, plates: [{ plate: 5, perSide: 1 }, { plate: 25, perSide: 2 }] },
      lb: DEFAULT_PLATE_RACKS.lb,
    });
    const racks = parsePlateRacks(json);
    expect(racks.unit).toBeNull();
    expect(racks.kg.plates.map((p) => p.plate)).toEqual([25, 5]);
  });
});

describe('rack edits', () => {
  const rack = DEFAULT_PLATE_RACKS.kg;

  it('setPlateCount changes one size, clamped to 0…max', () => {
    expect(setPlateCount(rack, 25, 3).plates[0]).toEqual({ plate: 25, perSide: 3 });
    expect(setPlateCount(rack, 25, -1).plates[0].perSide).toBe(0);
    expect(setPlateCount(rack, 25, 99).plates[0].perSide).toBe(MAX_PLATES_PER_SIDE);
    expect(setPlateCount(rack, 25, 3).plates.slice(1)).toEqual(rack.plates.slice(1));
  });

  it('addPlateSize adds a micro-plate in order, one per side', () => {
    const added = addPlateSize(rack, 0.5);
    expect(added.plates.at(-1)).toEqual({ plate: 0.5, perSide: 1 });
    expect(addPlateSize(rack, 30).plates[0]).toEqual({ plate: 30, perSide: 1 });
  });

  it('plateSizeProblem refuses zero, oversize, duplicate and a full rack', () => {
    expect(plateSizeProblem(rack, 0)).toBe('Enter a plate weight above 0.');
    expect(plateSizeProblem(rack, 101)).toBe('Plates go up to 100.');
    expect(plateSizeProblem(rack, 25)).toBe('That plate is already on the rack.');
    const full = { barWeight: 20, plates: Array.from({ length: MAX_PLATE_SIZES }, (_, i) => ({ plate: i + 1, perSide: 1 })) };
    expect(plateSizeProblem(full, 50)).toBe(`A rack holds up to ${MAX_PLATE_SIZES} plate sizes.`);
    expect(addPlateSize(full, 50)).toBe(full);
    expect(plateSizeProblem(rack, 0.5)).toBeNull();
  });

  it('removePlateSize takes a size off', () => {
    expect(removePlateSize(rack, 15).plates.map((p) => p.plate)).toEqual([25, 20, 10, 5, 2.5, 1.25]);
  });
});
