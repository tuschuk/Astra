/**
 * useAutosaveText — the typing-to-store pattern behind every title and note box in the logger
 * (LOG-3): the workout's title and note, each exercise's note, and each set's note.
 *
 * Why it exists: a note typed mid-workout must survive the app being killed, like everything
 * else in the logger (NFR-3). Saving only when the keyboard closes is not enough — that moment
 * never comes if the app is swiped away, the screen is left, or Finish is tapped with the
 * keyboard still up. So the box saves on its own a moment after the lifter stops typing:
 *
 *   - **debounced save:** each keystroke restarts a short timer (`delayMs`, ~¾ s); when typing
 *     settles, the text is handed to `save`. A kill loses at most that last moment of typing;
 *   - **flush:** saves any pending text right now and returns a promise that settles once the
 *     save has. Each box joins the screen's `AutosaveRegistry` (if one is provided), and the
 *     logger flushes every box before Finish — so a note typed in any box a second before
 *     tapping Finish lands in the finished workout;
 *   - **unmount flushes, it doesn't cancel:** closing a note box or leaving the screen mid-timer
 *     still saves the text (the store outlives the screen);
 *   - **dead workouts are left alone:** a pending save is dropped silently once the workout is
 *     no longer `active` (finished or discarded) — the text was either flushed already or
 *     belongs to a workout that no longer exists, and a stray "this workout is finished" error
 *     would only confuse;
 *   - **errors are reported, not thrown:** a refused save (text past the server's cap) shows up
 *     in `error` for the box's owner to display, and `flush` resolves to false — so a note box
 *     stays open instead of closing on a failed save, and Finish stops instead of finishing
 *     without the note.
 *
 * Inputs: `initial` (the saved text when the box first appears), `save` (the store call that
 * writes it), `store` (only asked whether the workout is still active). Output: the box's
 * `text`, its `onChangeText`, `flush`, and the last save `error` (null when fine).
 *
 * The box owns its text while it is on screen: later changes to the saved value (e.g. the
 * store trimming a trailing space) are deliberately not copied back in, or a word being typed
 * would lose its space mid-sentence.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { ActiveWorkoutStore } from './activeWorkout';

/** How long after the last keystroke the text is saved. */
export const AUTOSAVE_DELAY_MS = 750;

/**
 * Every autosaving box on a screen, so the screen can save them all at once — the logger does
 * this before Finish, so a note typed in any box (the workout's title, an exercise's note, a
 * set's note) a moment before tapping Finish still lands in the finished workout.
 */
export interface AutosaveRegistry {
  /** Adds a box's flush; returns a function that removes it again. */
  register(flush: () => Promise<boolean>): () => void;
  /**
   * Saves every box's pending text; resolves once all of the saves are done — true if every
   * box's text is saved, false if any box's save was refused (that box shows why).
   */
  flushAll(): Promise<boolean>;
}

/** Makes an empty registry (one per logger screen). */
export function createAutosaveRegistry(): AutosaveRegistry {
  const flushes = new Set<() => Promise<boolean>>();
  return {
    register(flush) {
      flushes.add(flush);
      return () => {
        flushes.delete(flush);
      };
    },
    flushAll: async () => {
      const results = await Promise.all([...flushes].map((flush) => flush()));
      return results.every(Boolean);
    },
  };
}

/**
 * Where a screen hands its registry down to the boxes inside it. A box outside any registry
 * still autosaves; it just can't be flushed from above.
 */
export const AutosaveRegistryContext = createContext<AutosaveRegistry | null>(null);

/** What `useAutosaveText` hands back to the box that uses it. */
export interface AutosaveText {
  /** What the box shows. */
  text: string;
  /** Hand this to the TextInput: updates the box and (re)starts the save timer. */
  onChangeText: (text: string) => void;
  /**
   * Saves pending text now. Resolves (never rejects) once the box's latest save is done: true
   * if it landed (or there was nothing to save), false if it was refused — so a caller can
   * stop, e.g. keep the box open or hold off finishing the workout.
   */
  flush: () => Promise<boolean>;
  /** The last failed save's error, or null. Cleared when a save succeeds. */
  error: unknown;
}

/**
 * Gives one title or note box its autosave (see the file comment for the full contract).
 * Inputs: `initial` text, the `save` store call, the `store` (asked only whether the workout is
 * still active) and an optional `delayMs`. Output: an `AutosaveText` for the box to wire up.
 */
export function useAutosaveText({
  initial,
  save,
  store,
  delayMs = AUTOSAVE_DELAY_MS,
}: {
  initial: string | null;
  save: (text: string) => Promise<unknown>;
  store: Pick<ActiveWorkoutStore, 'getStatus'>;
  delayMs?: number;
}): AutosaveText {
  const [text, setText] = useState(initial ?? '');
  const [error, setError] = useState<unknown>(null);
  // Text typed but not yet handed to `save` (null when there is none).
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  // The latest props, so a timer started several renders ago saves through the current ones.
  // (Updated after each render, never during it, as React asks.)
  const latest = useRef({ save, store });
  useEffect(() => {
    latest.current = { save, store };
  });

  // The latest save handed to `save` and whether it landed. A flush with nothing new to save
  // still waits for it and reports it, so Finish never races a save the timer already started
  // and never misses one that was refused.
  const lastSave = useRef<Promise<boolean>>(Promise.resolve(true));

  /**
   * Hands any pending text to `save` now (or drops it if the workout has ended). Resolves to
   * whether the box's latest save landed (see `AutosaveText.flush`).
   */
  const fire = useCallback((): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pending.current;
    pending.current = null;
    if (value == null) return lastSave.current;
    if (latest.current.store.getStatus() !== 'active') return Promise.resolve(true);
    const attempt = latest.current.save(value).then(
      () => {
        if (mounted.current) setError(null);
        return true;
      },
      (caught: unknown) => {
        if (mounted.current) setError(caught);
        else console.warn('A note could not be saved after its box closed', caught);
        return false;
      },
    );
    lastSave.current = attempt;
    return attempt;
  }, []);

  const onChangeText = useCallback(
    (next: string) => {
      setText(next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void fire(), delayMs);
    },
    [delayMs, fire],
  );

  // Leaving (the box closes or the screen goes away) saves what was typed instead of losing it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void fire();
    };
  }, [fire]);

  // Joins the screen's registry (if any), so the screen can save this box with all the others.
  const registry = useContext(AutosaveRegistryContext);
  useEffect(() => registry?.register(fire), [registry, fire]);

  return { text, onChangeText, flush: fire, error };
}
