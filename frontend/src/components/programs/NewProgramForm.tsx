/**
 * NewProgramForm — the "New program" panel on the Programs list (B34).
 *
 * What it shows: a full-screen panel with one Name box ("e.g. 12-week strength block").
 *
 * What the lifter can do: type a name (Save stays disabled until there is one; a name past the
 * server's 100-character limit is refused with a message); tap **Create program**, which saves the
 * empty program on the phone at once (no signal needed — it uploads with the next sync) and hands
 * it back so the list can open its page; or **Cancel** to throw the name away. The parent mounts
 * it fresh (via a `key`) each time it opens, so a cancelled name never comes back.
 */
import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { assertValidProgramName, MAX_PROGRAM_NAME_LENGTH } from '@training-math';

import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import type { ProgramRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { createProgram } from '@/programs/programs';
import { colors, layout, spacing } from '@/theme';

/**
 * True when the (trimmed) name breaks the server's length rule — asked of the shared check, so
 * the form and the save path agree on how characters are counted. Empty is not reported (Save is
 * simply disabled).
 */
export function programNameTooLong(trimmed: string): boolean {
  if (trimmed.length === 0) return false;
  try {
    assertValidProgramName(trimmed);
    return false;
  } catch {
    return true;
  }
}

export interface NewProgramFormProps {
  /** Whether the panel is open. */
  visible: boolean;
  /** The phone's database (null while it opens — Create then waits). */
  db: SqlDriver | null;
  /** The signed-in lifter, who will own the program. */
  userId: string | null;
  /** Called with the saved program after a successful create. */
  onCreated: (program: ProgramRow) => void;
  /** Called when the lifter cancels. */
  onClose: () => void;
}

export function NewProgramForm({ visible, db, userId, onCreated, onClose }: NewProgramFormProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const tooLong = programNameTooLong(trimmed);
  const canSave = trimmed.length > 0 && !tooLong && !busy && db !== null && userId !== null;

  /** Creates the program through the program module, then reports it. */
  async function save(): Promise<void> {
    if (!canSave || !db || !userId) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createProgram(db, userId, name));
    } catch (caught) {
      console.warn('New program: could not save', caught);
      setError('That program couldn’t be created. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.header}>
          <Heading size="section">New program</Heading>
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl, gap: spacing.lg }}
        >
          <TextField label="Program name" value={name} onChangeText={setName} placeholder="e.g. 12-week strength block" />
          {tooLong ? <FormError message={`Names can be at most ${MAX_PROGRAM_NAME_LENGTH} characters.`} /> : null}
          {error ? <FormError message={error} /> : null}
          <Button label="Create program" onPress={() => void save()} disabled={!canSave} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: layout.screenPadding,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
});
