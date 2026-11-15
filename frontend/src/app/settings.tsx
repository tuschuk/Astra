/**
 * Settings (YOU-4) — reached from the gear button on the You tab.
 *
 * What it shows, in two sections:
 *   - Units: a kg | lb choice. Tapping one switches every weight in the app to that unit at
 *     once — the logger, saved workouts, editing and exercise history all re-draw. The choice is
 *     saved on the phone straight away (so it works with no signal and survives the app being
 *     closed) and uploaded to the lifter's account, so their other devices follow. Logged
 *     weights are never changed: they are always stored in kg and only shown in the chosen unit.
 *   - Account: which email is signed in, and the Sign out button. Signing out needs no
 *     navigation here — the root guard sends the user to sign-in once the session is gone.
 *
 * Notifications and privacy settings arrive with their own features (B47, B26); they are not
 * shown until they work.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { WeightUnit } from '@training-math';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { unitStore } from '@/settings/unitStore';
import { colors, layout, radii, spacing } from '@/theme';

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
  signOut: {
    marginTop: spacing.sm,
  },
});
