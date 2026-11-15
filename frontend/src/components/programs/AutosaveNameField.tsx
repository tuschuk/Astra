/**
 * AutosaveNameField — a name box that saves itself as the lifter types (B34): the program's name
 * on its page, and a workout's name in the workout editor.
 *
 * What it shows: a labelled text box with the saved name, and a short message under it if the
 * last save was refused (an empty program name, or a name past the 100-character limit).
 *
 * What the lifter can do: type. A moment after they stop (and when they leave the screen) the
 * text is handed to `save` — the same debounced autosave the logger's title and notes use
 * (`useAutosaveText`), so a name typed just before the app is killed is still kept.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FormError } from '@/components/ui/FormError';
import { TextField } from '@/components/ui/TextField';
import { useAutosaveText } from '@/workout/useAutosaveText';

/**
 * The autosave hook asks a logger store whether its workout is still being logged; program
 * names have no such lifetime, so this stand-in always answers "yes, keep saving".
 */
const ALWAYS_SAVING = { getStatus: () => 'active' as const };

interface AutosaveNameFieldProps {
  /** The box's label ("Program name"). */
  label: string;
  /** The saved name when the box first appears (null = none). */
  initial: string | null;
  /** Writes the typed name; throws (a `RangeError` for a refused name) to show `errorMessage`. */
  save: (text: string) => Promise<unknown>;
  /** What to say when a save is refused. */
  errorMessage: string;
  /** Placeholder text for an empty box. */
  placeholder?: string;
}

export function AutosaveNameField({ label, initial, save, errorMessage, placeholder }: AutosaveNameFieldProps) {
  const name = useAutosaveText({ initial, save, store: ALWAYS_SAVING });
  return (
    <View style={styles.wrapper}>
      <TextField
        label={label}
        value={name.text}
        onChangeText={name.onChangeText}
        onBlur={() => void name.flush()}
        placeholder={placeholder}
      />
      {name.error ? <FormError message={errorMessage} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 4,
  },
});
