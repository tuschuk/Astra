/**
 * Settings (YOU-4) — reached from the gear button on the You tab.
 *
 * What it shows, in three sections:
 *   - Units: a kg | lb choice. Tapping one switches every weight in the app to that unit at
 *     once — the logger, saved workouts, editing and exercise history all re-draw. The choice is
 *     saved on the phone straight away (so it works with no signal and survives the app being
 *     closed) and uploaded to the lifter's account, so their other devices follow. Logged
 *     weights are never changed: they are always stored in kg and only shown in the chosen unit.
 *   - Privacy (B26):
 *       - Progress pics — who NEW progress pics are shown to: Only you (the default), Followers,
 *         or Public. Saved and uploaded exactly like the unit (works offline). Posts already made
 *         keep their own setting; a line says they're changed on the post itself.
 *       - Body data — a plain statement, not a control: body data is only ever visible to the
 *         lifter (the server enforces it). Nothing in the app shows body data to anyone yet, so
 *         there is nothing to choose; the choice arrives with the first feature that reads it.
 *   - Account: which email is signed in, and the Sign out button. Signing out needs no
 *     navigation here — the root guard sends the user to sign-in once the session is gone.
 *     Then (B32):
 *       - Export your data — downloads everything the lifter has on Astra as one JSON file and
 *         opens the share sheet to keep it (`account/exportData.ts`). Needs a connection; it
 *         holds what has synced, and says so.
 *       - Delete account — opens the delete screen, where typing DELETE confirms.
 *
 * Notification settings arrive with their own feature (B47); they are not shown until they work.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { WeightUnit } from '@training-math';

import { exportMyData } from '@/account/exportData';
import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { WorkoutVisibility } from '@/db/dao';
import { useAppDatabase } from '@/db/useAppDatabase';
import { getSupabase } from '@/lib/supabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { readProgressPicVisibility, setProgressPicVisibility } from '@/settings/privacySettings';
import { unitStore } from '@/settings/unitStore';
import { VISIBILITY_ORDER, VISIBILITY_WORDS } from '@/social/postPrivacy';
import { colors, layout, radii, spacing } from '@/theme';

/** What a screen reader says for each progress-pic choice. */
const PROGRESS_PIC_SPOKEN: Record<WorkoutVisibility, string> = {
  private: 'New progress pics: only you',
  followers: 'New progress pics: your followers',
  public: 'New progress pics: anyone on Astra',
};

/** The three progress-pic chips, most private first. */
const PROGRESS_PIC_OPTIONS: ChoiceOption<WorkoutVisibility>[] = VISIBILITY_ORDER.map((value) => ({
  value,
  label: VISIBILITY_WORDS[value].label,
  spoken: PROGRESS_PIC_SPOKEN[value],
}));

/** The Body data row's statement (B26). */
export const BODY_DATA_LINE = 'Only you. Body data never leaves your account.';

/** The small print under Export your data (B32): the export is the server's copy. */
export const EXPORT_NOTE = 'A JSON file of your workouts, sets, PRs, posts and settings. Includes everything that has synced to your account.';

/** The two units, in the order the toggle shows them, with what a screen reader says. */
const UNIT_OPTIONS: readonly { unit: WeightUnit; label: string; spoken: string }[] = [
  { unit: 'kg', label: 'kg', spoken: 'Kilograms' },
  { unit: 'lb', label: 'lb', spoken: 'Pounds' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const userId = session?.user.id ?? null;
  const { db } = useAppDatabase();
  const unit = useDisplayUnit();
  const [unitError, setUnitError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  // Null until read from the phone; the chips wait (disabled) rather than guess.
  const [picVisibility, setPicVisibility] = useState<WorkoutVisibility | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Read the progress-pic choice each time the screen comes into view, so a change downloaded
  // from another device since the last visit is what's shown.
  useFocusEffect(
    useCallback(() => {
      if (!db || !userId) return;
      let live = true;
      readProgressPicVisibility(db, userId)
        .then((value) => {
          if (live) setPicVisibility(value);
        })
        .catch((error: unknown) => {
          console.warn('Settings: could not read the privacy setting', error);
          if (live) setPrivacyError('Your privacy setting couldn’t be read. Try again.');
        });
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  /**
   * Saves who sees new progress pics (offline-safe: phone + upload queue in one go). The chip
   * moves at once and moves back, with a message, if the phone couldn't save it.
   */
  async function chooseProgressPicVisibility(next: WorkoutVisibility): Promise<void> {
    if (!db || !userId || picVisibility === null || next === picVisibility) return;
    const before = picVisibility;
    setPicVisibility(next);
    setPrivacyError(null);
    try {
      await setProgressPicVisibility(db, userId, next);
    } catch (error: unknown) {
      console.warn('Settings: could not save the privacy setting', error);
      setPicVisibility(before);
      setPrivacyError('Your privacy setting couldn’t be saved. Try again.');
    }
  }

  /** Saves the chosen unit; the store re-draws every weight. Shows an error if saving fails. */
  async function chooseUnit(next: WeightUnit): Promise<void> {
    if (!db || !userId || next === unit) return;
    setUnitError(null);
    try {
      await unitStore.setUnit(db, userId, next);
    } catch (error: unknown) {
      console.warn('Settings: could not save the weight unit', error);
      setUnitError('Your unit couldn’t be saved. Try again.');
    }
  }

  /** Signs out of this device; shows an error only if that somehow fails. */
  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    setSignOutError(null);
    const result = await signOut();
    setSigningOut(false);
    if (!result.ok) setSignOutError(result.message);
  }

  /** Builds the export and opens the share sheet; shows a calm line if it couldn't. */
  async function handleExport(): Promise<void> {
    setExporting(true);
    setExportError(null);
    const result = await exportMyData(getSupabase());
    setExporting(false);
    if (!result.ok) setExportError(result.message);
  }

  /** Back to the profile, or the You tab if there is nothing to go back to. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/you');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Settings</Heading>

      <SectionLabel style={styles.sectionLabel}>Units</SectionLabel>
      <Card style={styles.card}>
        <Body>Weight unit</Body>
        <View style={styles.segments} accessibilityRole="radiogroup">
          {UNIT_OPTIONS.map((option) => {
            const active = option.unit === unit;
            return (
              <Pressable
                key={option.unit}
                onPress={() => void chooseUnit(option.unit)}
                disabled={!db || !userId}
                accessibilityRole="radio"
                accessibilityLabel={option.spoken}
                accessibilityState={{ selected: active, checked: active, disabled: !db || !userId }}
                style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && styles.pressed]}
              >
                <SectionLabel style={active ? styles.segmentLabelActive : undefined}>{option.label}</SectionLabel>
              </Pressable>
            );
          })}
        </View>
        <Body variant="small" style={styles.muted}>
          Every weight is shown in this unit. Your logged weights are kept exactly as entered.
        </Body>
        <FormError message={unitError} />
      </Card>

      <SectionLabel style={styles.sectionLabel}>Privacy</SectionLabel>
      <Card style={styles.card}>
        <Body>Who can see new progress pics</Body>
        <ChoiceChips
          options={PROGRESS_PIC_OPTIONS}
          selected={picVisibility ?? 'private'}
          onSelect={(value) => void chooseProgressPicVisibility(value)}
          disabled={!db || !userId || picVisibility === null}
          fill
        />
        <Body variant="small" style={styles.muted}>
          Posts you’ve already shared keep their own setting — change one from the post itself.
        </Body>
        <FormError message={privacyError} />
      </Card>
      <Card style={[styles.card, styles.cardGap]}>
        <Body>Body data</Body>
        <Body variant="small" style={styles.muted}>
          {BODY_DATA_LINE}
        </Body>
      </Card>

      <SectionLabel style={styles.sectionLabel}>Account</SectionLabel>
      <Card style={styles.card}>
        <SectionLabel size="small">Signed in as</SectionLabel>
        <Body>{session?.user.email ?? 'Signed in'}</Body>
        <Button
          label="Sign out"
          variant="ghost"
          onPress={() => void handleSignOut()}
          disabled={signingOut}
          style={styles.signOut}
        />
        <FormError message={signOutError} />

        <Button
          label={exporting ? 'Exporting…' : 'Export your data'}
          variant="outline"
          onPress={() => void handleExport()}
          disabled={exporting}
          style={styles.signOut}
        />
        <Body variant="small" style={styles.muted}>
          {EXPORT_NOTE}
        </Body>
        <FormError message={exportError} />

        <Button
          label="Delete account"
          variant="outline"
          onPress={() => router.push('/delete-account')}
          style={styles.signOut}
        />
        <Body variant="small" style={styles.muted}>
          Removes your account and everything in it from Astra, for good.
        </Body>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
  },
  card: {
    gap: spacing.sm,
  },
  cardGap: {
    marginTop: spacing.md,
  },
  segments: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceDeep,
  },
  segmentActive: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
  },
  segmentLabelActive: {
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
  muted: {
    color: colors.muted,
  },
  // Space above each Account-card button (Sign out, Export, Delete).
  signOut: {
    marginTop: spacing.sm,
  },
});
