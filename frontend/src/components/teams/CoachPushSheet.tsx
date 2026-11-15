/**
 * CoachPushSheet — a team coach's two small choosers for pushing to the team (B37 — TEAM-3).
 *
 * What it shows, by mode:
 *   - **announcement**: a text box ("Announcement", up to 2000 characters) and **Push**. The
 *     team page sends it; a refusal or a too-long text comes back as a line under the box.
 *   - **workout**: after the coach picked one of their programs, every workout of it, listed
 *     "Week 1 · Day A", read from the coach's own phone. Tapping one pushes that workout.
 * Or **Cancel**. Pushing a whole program doesn't need this sheet — the program picker does it.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_TEAM_ANNOUNCEMENT_LENGTH } from '@training-math';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormError } from '@/components/ui/FormError';
import { TextField } from '@/components/ui/TextField';
import { Body, Heading } from '@/components/ui/Text';
import type { SqlDriver } from '@/db/driver';
import { readProgramTree, type ProgramTree } from '@/programs/programs';
import { colors, layout, spacing, type } from '@/theme';

/** Which chooser is open: the announcement box, or the workouts of one program. */
export type CoachPushMode = { kind: 'announcement' } | { kind: 'workout'; programId: string };

export interface CoachPushSheetProps {
  /** What to show; null closes the sheet. */
  mode: CoachPushMode | null;
  /** The phone's database, for reading the picked program's workouts. */
  db: SqlDriver | null;
  /** The signed-in coach. */
  userId: string | null;
  /** True while the team page is sending the push. */
  busy: boolean;
  /** A refusal to show, or null. */
  message: string | null;
  /** The coach pushed an announcement with this text. */
  onPushAnnouncement: (body: string) => void;
  /** The coach picked this program workout to push. */
  onPushWorkout: (programWorkoutId: string) => void;
  /** Cancel was tapped. */
  onClose: () => void;
}

export function CoachPushSheet({
  mode,
  db,
  userId,
  busy,
  message,
  onPushAnnouncement,
  onPushWorkout,
  onClose,
}: CoachPushSheetProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [tree, setTree] = useState<ProgramTree | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const programId = mode?.kind === 'workout' ? mode.programId : null;

  // The picked program's workouts, read from the coach's phone. (The caller gives each opening
  // its own `key`, so the box and this list always start fresh.)
  useEffect(() => {
    if (!programId || !db || !userId) return;
    let live = true;
    readProgramTree(db, userId, programId)
      .then((t) => {
        if (live) setTree(t);
      })
      .catch((caught: unknown) => {
        console.warn('Coach push: could not read the program', caught);
        if (live) setReadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [programId, db, userId]);

  const workouts = (tree?.weeks ?? []).flatMap((week) =>
    week.workouts.map((w) => ({ id: w.workout.id, label: `Week ${week.number} · ${w.label}` })),
  );

  return (
    <Modal visible={mode !== null} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.header}>
          <Heading size="section">{mode?.kind === 'workout' ? 'Push a workout' : 'Push an announcement'}</Heading>
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl, gap: spacing.md }}>
          <FormError message={message} />
          {mode?.kind === 'announcement' ? (
            <>
              <TextField
                label="Announcement"
                value={text}
                onChangeText={setText}
                multiline
                maxLength={MAX_TEAM_ANNOUNCEMENT_LENGTH}
                placeholder="Deload this week — keep every set at RPE 7."
              />
              <Button label="Push" onPress={() => onPushAnnouncement(text)} disabled={busy || text.trim() === ''} />
            </>
          ) : null}
          {mode?.kind === 'workout' ? (
            <>
              <Body variant="muted">Pick the workout to push. Members can start it from the team page.</Body>
              {readFailed ? <Body variant="small">This program couldn’t be read from this phone.</Body> : null}
              {tree && workouts.length === 0 ? <Body variant="small">This program has no workouts yet.</Body> : null}
              {workouts.map((w) => (
                <Pressable
                  key={w.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Push ${w.label}`}
                  disabled={busy}
                  onPress={() => onPushWorkout(w.id)}
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Card>
                    <Body style={styles.name}>{w.label}</Body>
                  </Card>
                </Pressable>
              ))}
            </>
          ) : null}
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
  name: {
    ...type.cardTitle,
  },
  pressed: {
    opacity: 0.7,
  },
});
