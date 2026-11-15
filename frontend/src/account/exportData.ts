/**
 * Settings → Export your data (B32, NFR-6 — "export training data").
 *
 * What it does: asks the `export-data` server function for the lifter's complete Astra data as
 * one JSON document, saves it to a file named `astra-export-<date>.json` in the app's cache
 * folder, and opens the phone's share sheet so the lifter can keep it wherever they like (Files,
 * email, a drive…). Once the share sheet closes — shared or cancelled — the cache copy is
 * deleted: it holds body data, and nothing in the app will ever read it again.
 *
 * The export is the server's copy, so it holds everything that has synced. A workout logged a
 * minute ago with no signal is still on the phone; it uploads on reconnect as always, and the
 * lifter can export again. With no connection the request simply fails and says so — there is
 * no separate "are we online?" check that could disagree with it.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { localToday } from '@/auth/age';

import { callFunction, type FunctionsClient } from './functionCalls';

/** Shown when the export request got no answer. */
export const EXPORT_OFFLINE = 'Exporting needs a connection. Try again when you’re online.';
/** Shown when the server answered with an error, or the file couldn't be saved. */
export const EXPORT_FAILED = 'Your export couldn’t be made right now. Try again.';
/** Shown when this phone has no share sheet to hand the file to. */
export const EXPORT_CANT_SHARE = 'This phone can’t share files from Astra.';

/** How the flow ended: shared (or the share sheet was closed), or a message to show. */
export type ExportResult = { ok: true } | { ok: false; message: string };

/** The phone abilities the flow needs, injectable so tests run without the native modules. */
export interface ExportDevice {
  /** The app's cache folder (ends in `/`), or null if the phone has none. */
  cacheDirectory: string | null;
  writeFile(uri: string, text: string): Promise<void>;
  removeFile(uri: string): Promise<void>;
  canShare(): Promise<boolean>;
  /** Opens the share sheet for the file; resolves when it closes. */
  share(uri: string): Promise<void>;
  /** Today's date on the phone, `yyyy-mm-dd`. */
  today(): string;
}

/** The real phone. */
export const phoneExportDevice: ExportDevice = {
  cacheDirectory: FileSystem.cacheDirectory,
  writeFile: (uri, text) => FileSystem.writeAsStringAsync(uri, text),
  removeFile: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  canShare: () => Sharing.isAvailableAsync(),
  share: (uri) =>
    Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save your Astra data' }),
  today: () => localToday(),
};

/** The export file's name for a given day, e.g. `astra-export-2026-11-15.json`. */
export function exportFileName(date: string): string {
  return `astra-export-${date}.json`;
}

/**
 * Runs the whole export (see the file comment). `client` is the signed-in Supabase client (its
 * `functions.invoke` sends the lifter's login). Never throws; resolves with what to tell the
 * lifter.
 */
export async function exportMyData(client: FunctionsClient, device: ExportDevice = phoneExportDevice): Promise<ExportResult> {
  if (!device.cacheDirectory || !(await device.canShare().catch(() => false))) {
    return { ok: false, message: EXPORT_CANT_SHARE };
  }

  const outcome = await callFunction(client, 'export-data');
  if (outcome.kind === 'offline') return { ok: false, message: EXPORT_OFFLINE };
  if (outcome.kind === 'failed' || typeof outcome.data !== 'object' || outcome.data === null) {
    return { ok: false, message: EXPORT_FAILED };
  }

  const uri = `${device.cacheDirectory}${exportFileName(device.today())}`;
  try {
    await device.writeFile(uri, JSON.stringify(outcome.data, null, 2));
  } catch (error: unknown) {
    console.warn('Export: could not save the file', error);
    return { ok: false, message: EXPORT_FAILED };
  }
  try {
    await device.share(uri);
    return { ok: true };
  } catch (error: unknown) {
    console.warn('Export: the share sheet failed', error);
    return { ok: false, message: EXPORT_FAILED };
  } finally {
    await device.removeFile(uri).catch((error: unknown) => console.warn('Export: could not delete the cache copy', error));
  }
}
