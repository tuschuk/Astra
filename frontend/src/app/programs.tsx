/**
 * Programs — the lifter's own training programs (PRG-1, PRG-2, B34), opened from the Workout
 * tab's **Your programs** button.
 *
 * What it shows: every program the lifter has written, newest first, each with its name and its
 * size ("2 weeks · 6 workouts"). With none yet, a short explanation of what a program is.
 *
 * What the lifter can do: tap a program to open its page (where it is built and edited); tap
 * **New program**, name it, and land straight on its page; or go Back. Everything is read from
 * and written to the phone, so it all works with no signal; it re-reads each time the screen comes
 * into view, so a program deleted or renamed on its page is current here.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { NewProgramForm } from '@/components/programs/NewProgramForm';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { useAppDatabase } from '@/db/useAppDatabase';
import { formatProgramSize, listPrograms, type ProgramSummary } from '@/programs/programs';
import { spacing, type } from '@/theme';

export default function ProgramsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const [loaded, setLoaded] = useState<{ forUser: string; rows: ProgramSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A counter, so the form mounts fresh (empty) each time it opens; null while closed.
  const [formKey, setFormKey] = useState<number | null>(null);

  /** Re-reads the lifter's programs from the phone. */
  const refresh = useCallback(async () => {
    if (!db || !userId) return;
    try {
      setLoaded({ forUser: userId, rows: await listPrograms(db, userId) });
      setError(null);
    } catch (caught) {
      console.warn('Programs: could not read programs from the phone', caught);
      setError('Your programs couldn’t be read from this phone.');
    }
  }, [db, userId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  /** Back to the Workout tab (or wherever this was opened from). */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  // Tagged by lifter, so a sign-out / sign-in never shows the previous account's list.
  const rows = loaded && loaded.forUser === userId ? loaded.rows : null;

  const header = (
    <View>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Programs</Heading>
      <Body variant="muted" style={styles.lede}>
        Plan your training as weeks of workouts, with sets, reps and a target load for every exercise.
      </Body>
      <Button
        label="New program"
        onPress={() => setFormKey((k) => (k ?? 0) + 1)}
        disabled={!db || !userId}
        style={styles.newButton}
      />
      <FormError message={dbError ? 'This phone’s storage couldn’t be opened.' : error} />
      <SectionLabel style={styles.listLabel}>Your programs</SectionLabel>
    </View>
  );

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <FlatList
        data={rows ?? []}
        keyExtractor={(item) => item.program.id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.program.name}`}
            onPress={() => router.push({ pathname: '/program/[id]', params: { id: item.program.id } })}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Card style={styles.card}>
              <Body style={styles.name}>{item.program.name}</Body>
              <SectionLabel size="small">{formatProgramSize(item)}</SectionLabel>
            </Card>
          </Pressable>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          rows ? (
            <EmptyState
              icon="calendar-outline"
              message="No programs yet. A program is a plan of weeks, each with workouts and the exercises to do in them."
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
      {formKey !== null ? (
        <NewProgramForm
          key={formKey}
          visible
          db={db}
          userId={userId}
          onCreated={(program) => {
            setFormKey(null);
            router.push({ pathname: '/program/[id]', params: { id: program.id } });
          }}
          onClose={() => setFormKey(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  lede: {
    marginTop: spacing.sm,
  },
  newButton: {
    marginTop: spacing.xl,
  },
  listLabel: {
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  row: {
    marginBottom: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  card: {
    gap: spacing.xs,
  },
  name: {
    ...type.cardTitle,
  },
  screenContent: {
    paddingBottom: 0,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
});
