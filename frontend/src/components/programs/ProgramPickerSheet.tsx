/**
 * ProgramPickerSheet — "Start from a program" on the Workout tab (PRG-3, B35).
 *
 * What it shows: a full-screen panel listing the lifter's own programs, newest first, each with
 * its name and size ("2 weeks · 6 workouts"). A program with no workouts yet is listed but can't
 * be picked ("No workouts yet — add some first"), so it never just vanishes from the list. With no
 * programs at all, a short note and a **Your programs** button to go and build one.
 *
 * What the lifter can do: tap a program to start running it — the run is saved on the phone at
 * once (works with no signal) and begins at the program's first session; any program that was
 * running is ended in the same save. The panel then closes and the tab shows the run, with
 * "Start next session". Or **Cancel**.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { ProgramRunRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { startProgramRun } from '@/programs/programRuns';
import { formatProgramSize, listPrograms, type ProgramSummary } from '@/programs/programs';
import { colors, layout, spacing, type } from '@/theme';

export interface ProgramPickerSheetProps {
  /** Whether the panel is open. */
  visible: boolean;
  /** The phone's database (null while it opens). */
  db: SqlDriver | null;
  /** The signed-in lifter, whose programs are listed and who will run the pick. */
  userId: string | null;
  /** Called with the new run once the picked program has started. */
  onStarted: (run: ProgramRunRow) => void;
  /** Called when the lifter wants to go and build a program (the empty state's button). */
  onOpenPrograms: () => void;
  /** Called when the lifter cancels. */
  onClose: () => void;
}

export function ProgramPickerSheet({ visible, db, userId, onStarted, onOpenPrograms, onClose }: ProgramPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-read the list every time the panel opens, so it is always current.
  useEffect(() => {
    if (!visible || !db || !userId) return;
    let live = true;
    listPrograms(db, userId)
      .then((rows) => {
        if (!live) return;
        setPrograms(rows);
        setError(null);
      })
      .catch((caught: unknown) => {
        console.warn('Program picker: could not read programs', caught);
        if (live) setError('Your programs couldn’t be read from this phone.');
      });
    return () => {
      live = false;
    };
  }, [visible, db, userId]);

  /** Starts running `programId` and reports the new run. */
  async function pick(programId: string): Promise<void> {
    if (!db || !userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await startProgramRun(db, userId, programId));
    } catch (caught) {
      console.warn('Program picker: could not start the program', caught);
      setError('That program couldn’t be started. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.header}>
          <Heading size="section">Start a program</Heading>
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl, gap: spacing.md }}>
          <Body variant="muted">Pick a program to run. Each tap of Start next session opens its next workout.</Body>
          <FormError message={error} />
          {programs && programs.length === 0 ? (
            <View style={styles.empty}>
              <EmptyState icon="calendar-outline" message="No programs yet. Build one first, then start it here." />
              <Button label="Your programs" variant="outline" onPress={onOpenPrograms} />
            </View>
          ) : null}
          {(programs ?? []).map((item) => {
            const runnable = item.workoutCount > 0;
            return (
              <Pressable
                key={item.program.id}
                accessibilityRole="button"
                accessibilityLabel={`Start ${item.program.name}`}
                accessibilityState={{ disabled: !runnable || busy }}
                disabled={!runnable || busy}
                onPress={() => void pick(item.program.id)}
                style={({ pressed }) => [pressed && styles.pressed, !runnable && styles.disabled]}
              >
                <Card style={styles.card}>
                  <Body style={styles.name}>{item.program.name}</Body>
                  <SectionLabel size="small">
                    {runnable ? formatProgramSize(item) : 'No workouts yet — add some first'}
                  </SectionLabel>
                </Card>
              </Pressable>
            );
          })}
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
  empty: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.xs,
  },
  name: {
    ...type.cardTitle,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
