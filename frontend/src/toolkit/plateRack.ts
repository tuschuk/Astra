/**
 * The plate rack — the bar and plates the plate loader (TK-4) works with — and where it is
 * saved on the phone.
 *
 * Why this exists: the plate loader can only say "2 × 25 kg per side" if it knows which plates
 * the lifter actually has. Gyms differ (no 15s, a pair of 1.25s, a 15 kg bar…), so the lifter
 * edits the rack once and it is remembered. Plates are real objects, so a rack is described in
 * its own unit: a kg rack of kg plates, an lb rack of lb plates. Two racks are kept, one per
 * unit, so switching the plate screen between kg and lb never throws away the other one's edits.
 *
 * Where it is saved: on this phone only, in expo-sqlite's key-value store (the same store that
 * keeps the sign-in), under one key, as JSON with a version number. It is not synced and not
 * tied to an account: a rack describes the equipment in a place, not anyone's training, so two
 * accounts on one phone lift on the same plates. (Decided in docs/feature_plans/tool-kit-calculators.md.)
 *
 * Nothing here can crash the screen: a missing or damaged saved rack falls back to the default
 * rack, and a failed save is logged and shrugged off (the worst case is a reset rack next launch).
 */
import KeyValueStore from 'expo-sqlite/kv-store';
import type { PlateInventoryItem, WeightUnit } from '@training-math';

/** One rack: the bar's weight and the plates available, counted per side of the bar. */
export interface PlateRackConfig {
  barWeight: number;
  /** Heaviest plate first. `perSide` is how many of that plate can go on *each* side. */
  plates: PlateInventoryItem[];
}

/** Everything the plate loader remembers: one rack per unit, and which one is showing. */
export interface PlateRacks {
  /** The rack unit last chosen on the plate screen, or null = follow the display unit. */
  unit: WeightUnit | null;
  kg: PlateRackConfig;
  lb: PlateRackConfig;
}

/** The key the racks are saved under in the key-value store. */
export const PLATE_RACK_KEY = 'astra.toolkit.plateRack';
/** The saved format's version; a future change of shape bumps it. */
const STORAGE_VERSION = 1;

/**
 * Upper limits on what the rack and the loader accept. Well beyond any real rack or lift, and
 * there to bound the plate solver's work (it walks every per-side weight up to the target):
 * at all of these maxima together it measured ~20 ms on a desktop (B16), a real rack far less.
 */
export const MAX_PLATES_PER_SIDE = 20;
export const MAX_PLATE_SIZES = 12;
export const MAX_PLATE_WEIGHT = 100;
export const MAX_BAR_WEIGHT = 100;
export const MAX_TARGET_WEIGHT = 2000;

/**
 * The racks a new phone starts with — a fully stocked commercial gym, as a starting point the
 * editor exists to change (not a claim about any particular gym).
 */
export const DEFAULT_PLATE_RACKS: PlateRacks = {
  unit: null,
  kg: {
    barWeight: 20,
    plates: [
      { plate: 25, perSide: 2 },
      { plate: 20, perSide: 2 },
      { plate: 15, perSide: 1 },
      { plate: 10, perSide: 1 },
      { plate: 5, perSide: 1 },
      { plate: 2.5, perSide: 1 },
      { plate: 1.25, perSide: 1 },
    ],
  },
  lb: {
    barWeight: 45,
    plates: [
      { plate: 45, perSide: 4 },
      { plate: 35, perSide: 1 },
      { plate: 25, perSide: 1 },
      { plate: 10, perSide: 2 },
      { plate: 5, perSide: 1 },
      { plate: 2.5, perSide: 1 },
    ],
  },
};

/** The slice of the key-value store this file uses — swappable in tests. */
export interface RackStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Plate weights are compared and kept to the hundredth (the solver's own precision). */
const toHundredths = (value: number): number => Math.round(value * 100);

/** Heaviest plate first, the order the editor lists them and the loader answers in. */
function sortPlates(plates: PlateInventoryItem[]): PlateInventoryItem[] {
  return [...plates].sort((a, b) => b.plate - a.plate);
}

/** True when `value` is a finite number in (`min`, `max`] (or [`min`, `max`] when `allowMin`). */
function inRange(value: unknown, min: number, max: number, allowMin = false): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (allowMin ? value >= min : value > min) &&
    value <= max
  );
}

/**
 * Checks one saved rack, returning it (plates sorted) or null if anything about it is off —
 * a bar or plate out of range, a fractional count, duplicate sizes, too many sizes.
 */
function readRack(raw: unknown): PlateRackConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { barWeight, plates } = raw as { barWeight?: unknown; plates?: unknown };
  if (!inRange(barWeight, 0, MAX_BAR_WEIGHT, true)) return null;
  if (!Array.isArray(plates) || plates.length > MAX_PLATE_SIZES) return null;
  const seen = new Set<number>();
  const checked: PlateInventoryItem[] = [];
  for (const item of plates as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const { plate, perSide } = item as { plate?: unknown; perSide?: unknown };
    if (!inRange(plate, 0, MAX_PLATE_WEIGHT)) return null;
    if (typeof perSide !== 'number' || !Number.isInteger(perSide) || perSide < 0 || perSide > MAX_PLATES_PER_SIDE) {
      return null;
    }
    if (seen.has(toHundredths(plate))) return null;
    seen.add(toHundredths(plate));
    checked.push({ plate, perSide });
  }
  return { barWeight, plates: sortPlates(checked) };
}

/**
 * Reads the saved JSON back into racks. Input: whatever was stored (or null for nothing saved).
 * Output: the racks, with any part that is missing or damaged replaced by its default — a
 * corrupt lb rack never costs the lifter their kg rack. Never throws.
 */
export function parsePlateRacks(json: string | null): PlateRacks {
  if (json == null) return DEFAULT_PLATE_RACKS;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_PLATE_RACKS;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PLATE_RACKS;
  const saved = raw as { version?: unknown; unit?: unknown; kg?: unknown; lb?: unknown };
  if (saved.version !== STORAGE_VERSION) return DEFAULT_PLATE_RACKS;
  return {
    unit: saved.unit === 'kg' || saved.unit === 'lb' ? saved.unit : null,
    kg: readRack(saved.kg) ?? DEFAULT_PLATE_RACKS.kg,
    lb: readRack(saved.lb) ?? DEFAULT_PLATE_RACKS.lb,
  };
}

/** The racks as the JSON string that gets saved. */
export function serializePlateRacks(racks: PlateRacks): string {
  return JSON.stringify({ version: STORAGE_VERSION, ...racks });
}

// The racks as last loaded or saved during this app session, so reopening the sheet shows the
// rack straight away instead of waiting on storage again.
let cached: PlateRacks | null = null;

/** The racks already in memory, or null if this app session hasn't read them yet. */
export function getCachedPlateRacks(): PlateRacks | null {
  return cached;
}

/**
 * The racks to show: from memory if already read this session, otherwise from the phone's
 * storage (defaults if nothing is saved, it is damaged, or storage can't be read).
 */
export async function loadPlateRacks(storage: RackStorage = KeyValueStore): Promise<PlateRacks> {
  if (cached) return cached;
  let json: string | null = null;
  try {
    json = await storage.getItem(PLATE_RACK_KEY);
  } catch (error: unknown) {
    console.warn('Plate rack: could not read the saved rack; using the default', error);
  }
  // An edit saved while storage was being read wins over what was read.
  cached ??= parsePlateRacks(json);
  return cached;
}

/**
 * Remembers new racks: in memory at once, and on the phone in the background. A failed save is
 * logged, not shown — the rack still works for this session.
 */
export function savePlateRacks(racks: PlateRacks, storage: RackStorage = KeyValueStore): void {
  cached = racks;
  storage.setItem(PLATE_RACK_KEY, serializePlateRacks(racks)).catch((error: unknown) => {
    console.warn('Plate rack: could not save the rack on this phone', error);
  });
}

/** Forgets the in-memory copy, so the next load reads storage again. Tests only. */
export function resetPlateRackCache(): void {
  cached = null;
}

/**
 * A rack with one plate size's per-side count changed (kept within 0–`MAX_PLATES_PER_SIDE`).
 * A count of 0 keeps the size on the rack, just with none available.
 */
export function setPlateCount(rack: PlateRackConfig, plate: number, perSide: number): PlateRackConfig {
  const count = Math.max(0, Math.min(MAX_PLATES_PER_SIDE, Math.round(perSide)));
  return {
    ...rack,
    plates: rack.plates.map((item) =>
      toHundredths(item.plate) === toHundredths(plate) ? { ...item, perSide: count } : item,
    ),
  };
}

/** Why a new plate size can't be added, in the lifter's words — or null when it can. */
export function plateSizeProblem(rack: PlateRackConfig, plate: number): string | null {
  const hundredths = toHundredths(plate);
  if (!Number.isFinite(plate) || hundredths <= 0) return 'Enter a plate weight above 0.';
  if (plate > MAX_PLATE_WEIGHT) return `Plates go up to ${MAX_PLATE_WEIGHT}.`;
  if (rack.plates.some((item) => toHundredths(item.plate) === hundredths)) return 'That plate is already on the rack.';
  if (rack.plates.length >= MAX_PLATE_SIZES) return `A rack holds up to ${MAX_PLATE_SIZES} plate sizes.`;
  return null;
}

/**
 * A rack with a new plate size added (one per side to start), kept heaviest first. The weight
 * is kept to the hundredth, the precision the loader solves in. Check `plateSizeProblem` first;
 * a size it refuses is returned unchanged.
 */
export function addPlateSize(rack: PlateRackConfig, plate: number): PlateRackConfig {
  if (plateSizeProblem(rack, plate) !== null) return rack;
  return { ...rack, plates: sortPlates([...rack.plates, { plate: toHundredths(plate) / 100, perSide: 1 }]) };
}

/** A rack with one plate size taken off entirely. */
export function removePlateSize(rack: PlateRackConfig, plate: number): PlateRackConfig {
  return { ...rack, plates: rack.plates.filter((item) => toHundredths(item.plate) !== toHundredths(plate)) };
}
