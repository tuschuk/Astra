/**
 * Settings (YOU-4) — reached from the gear button on the You tab.
 *
 * What it shows, in four sections:
 *   - Units: a kg | lb choice. Tapping one switches every weight in the app to that unit at
 *     once — the logger, saved workouts, editing and exercise history all re-draw. The choice is
 *     saved on the phone straight away (so it works with no signal and survives the app being
 *     closed) and uploaded to the lifter's account, so their other devices follow. Logged
 *     weights are never changed: they are always stored in kg and only shown in the chosen unit.
 *   - Privacy (B26):
 *       - Progress pics — who NEW progress pics are shown to: Only you (the default), Followers,
 *         or Public. Saved and uploaded exactly like the unit (works offline). Posts already made
 *         keep their own setting; a line says they're changed on the post itself.
 *       - Who can message you (B48) — Anyone (the default) or Mutual follows (lifters you follow
 *         who follow you back). Decides who may START a direct-message conversation with you;
 *         existing conversations stay open (block the lifter to stop one). Saved and uploaded like
 *         the unit; the server enforces its own copy.
 *       - Body data — a plain statement, not a control: body data is only ever visible to the
 *         lifter (the server enforces it). Nothing in the app shows body data to anyone yet, so
 *         there is nothing to choose; the choice arrives with the first feature that reads it.
 *   - Notifications (B47): five switches — new followers, comments on your posts, upvotes on your
 *     posts, Team posts, and (B48) messages. Each is on until turned off; turning one off stops exactly that kind of
 *     push (the server's `notify` function reads the switch before sending). Saved and uploaded
 *     like the unit, so it works offline and reaches the server on reconnect. Under them, a line
 *     saying where push stands on this phone — on; off, with "Turn on push notifications" (which
 *     shows the phone's permission prompt); refused in the phone's settings; not set up on this
 *     version of the app; or couldn't be turned on, with "Try again". The switches work in
 *     every one of those states: they are account settings, not phone ones.
 *   - Account: which email is signed in, and the Sign out button (which first asks the server to
 *     forget this phone's push token, best effort, B47). Signing out needs no
 *     navigation here — the root guard sends the user to sign-in once the session is gone.
 *     Then (B32):
 *       - Export your data — downloads everything the lifter has on Astra as one JSON file and
 *         opens the share sheet to keep it (`account/exportData.ts`). Needs a connection; it
 *         holds what has synced, and says so.
 *       - Delete account — opens the delete screen, where typing DELETE confirms.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
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
import { pushRegistration, type PushState } from '@/notifications/pushRegistration';
import { readDmPolicy, setDmPolicy, type DmPolicy } from '@/settings/dmSettings';
import { useDisplayUnit } from '@/settings/displayUnit';
import {
  readNotificationSwitches,
  setNotificationSwitch,
  type NotificationSwitches,
  type NotifyField,
} from '@/settings/notificationSettings';
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

/** The five notification switches (B47; Messages, B48), in the order shown, with their labels. */
export const NOTIFICATION_ROWS: readonly { field: NotifyField; label: string }[] = [
  { field: 'notify_follows', label: 'New followers' },
  { field: 'notify_comments', label: 'Comments on your posts' },
  { field: 'notify_votes', label: 'Upvotes on your posts' },
  { field: 'notify_team_pushes', label: 'Team posts' },
  { field: 'notify_messages', label: 'Messages' },
];

/** The two "who can message you" chips (B48), most open first. */
const DM_OPTIONS: ChoiceOption<DmPolicy>[] = [
  { value: 'anyone', label: 'Anyone', spoken: 'Anyone on Astra can message you' },
  { value: 'mutual_follows', label: 'Mutual follows', spoken: 'Only lifters you follow who follow you back can message you' },
];

/** The small print under the "who can message you" chips (B48). */
export const DM_POLICY_NOTE =
  'Applies to new conversations. To stop an existing one, block the lifter from their profile.';

/** The line under the switches for each state push can be in on this phone (B47). */
export const PUSH_STATE_LINES: Record<PushState, string> = {
  on: 'Push notifications are on for this device.',
  off: 'Push notifications are off for this device.',
  denied: 'Notifications for Astra are turned off in your phone’s settings. Turn them on there to get these.',
  unavailable: 'Push notifications aren’t set up on this version of the app yet. Your choices are saved and apply once they are.',
  failed: 'Push notifications couldn’t be turned on just now. Check your connection and try again.',
};

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
  // B48: who can start a conversation with me (null until read from the phone).
  const [dmPolicy, setDmPolicyState] = useState<DmPolicy | null>(null);
  const [dmError, setDmError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // B47: the five switches (null until read) and where push stands on this phone (null while checking).
  const [switches, setSwitches] = useState<NotificationSwitches | null>(null);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  // Read the progress-pic choice and the notification switches each time the screen comes into
  // view, so a change downloaded from another device since the last visit is what's shown. Also
  // check where push stands — a no-prompt registration, which re-saves the token if permission
  // was already given (it never shows the permission dialog).
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
      readDmPolicy(db, userId)
        .then((value) => {
          if (live) setDmPolicyState(value);
        })
        .catch((error: unknown) => {
          console.warn('Settings: could not read the messaging setting', error);
          if (live) setDmError('Your messaging setting couldn’t be read. Try again.');
        });
      readNotificationSwitches(db, userId)
        .then((value) => {
          if (live) setSwitches(value);
        })
        .catch((error: unknown) => {
          console.warn('Settings: could not read the notification settings', error);
          if (live) setNotifyError('Your notification settings couldn’t be read. Try again.');
        });
      pushRegistration
        .register(userId, { ask: false })
        .then((state) => {
          if (live) setPushState(state);
        })
        .catch((error: unknown) => console.warn('Settings: could not check push', error));
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  /**
   * Turns one notification switch on or off (offline-safe: phone + upload queue in one go). The
   * switch moves at once and moves back, with a message, if the phone couldn't save it. Only the
   * one column changes — every other setting, including the other three switches, is untouched.
   */
  async function flipSwitch(field: NotifyField, on: boolean): Promise<void> {
    if (!db || !userId || switches === null || switches[field] === on) return;
    // Per-field updates, so a quick flip of a second switch can't undo or be undone by this one.
    setSwitches((current) => (current ? { ...current, [field]: on } : current));
    setNotifyError(null);
    try {
      await setNotificationSwitch(db, userId, field, on);
    } catch (error: unknown) {
      console.warn('Settings: could not save the notification setting', error);
      setSwitches((current) => (current ? { ...current, [field]: !on } : current));
      setNotifyError('Your notification setting couldn’t be saved. Try again.');
    }
  }

  /** Asks the phone for permission (this is the one place besides the first Post that may prompt). */
  async function turnOnPush(): Promise<void> {
    if (!userId || pushBusy) return;
    setPushBusy(true);
    try {
      setPushState(await pushRegistration.register(userId, { ask: true }));
    } catch (error: unknown) {
      console.warn('Settings: could not turn on push', error);
      setPushState('failed');
    } finally {
      setPushBusy(false);
    }
  }

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

  /**
   * (B48) Saves who may start a conversation with the lifter (offline-safe: phone + upload queue
   * in one go). The chip moves at once and moves back, with a message, if the phone couldn't save
   * it. The server enforces its own copy once the upload lands.
   */
  async function chooseDmPolicy(next: DmPolicy): Promise<void> {
    if (!db || !userId || dmPolicy === null || next === dmPolicy) return;
    const before = dmPolicy;
    setDmPolicyState(next);
    setDmError(null);
    try {
      await setDmPolicy(db, userId, next);
    } catch (error: unknown) {
      console.warn('Settings: could not save the messaging setting', error);
      setDmPolicyState(before);
      setDmError('Your messaging setting couldn’t be saved. Try again.');
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

  /**
   * Signs out of this device; shows an error only if that somehow fails. First (B47) it asks the
   * server to forget this phone's push token, so the next person to use it doesn't get this
   * lifter's notifications — best effort, capped at a few seconds, and never in the way: offline,
   * sign-out carries on regardless.
   */
  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    setSignOutError(null);
    await pushRegistration.unregister();
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
        <Body>Who can message you</Body>
        <ChoiceChips
          options={DM_OPTIONS}
          selected={dmPolicy ?? 'anyone'}
          onSelect={(value) => void chooseDmPolicy(value)}
          disabled={!db || !userId || dmPolicy === null}
          fill
        />
        <Body variant="small" style={styles.muted}>
          {DM_POLICY_NOTE}
        </Body>
        <FormError message={dmError} />
      </Card>
      <Card style={[styles.card, styles.cardGap]}>
        <Body>Body data</Body>
        <Body variant="small" style={styles.muted}>
          {BODY_DATA_LINE}
        </Body>
      </Card>

      <SectionLabel style={styles.sectionLabel}>Notifications</SectionLabel>
      <Card style={styles.card}>
        <Body>Send me a push for</Body>
        {NOTIFICATION_ROWS.map((row) => (
          <View key={row.field} style={styles.switchRow}>
            <Body style={styles.switchLabel}>{row.label}</Body>
            <Switch
              value={switches?.[row.field] ?? true}
              onValueChange={(on) => void flipSwitch(row.field, on)}
              disabled={!db || !userId || switches === null}
              accessibilityLabel={`Push notifications for ${row.label.toLowerCase()}`}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor={colors.text}
            />
          </View>
        ))}
        <FormError message={notifyError} />
        {pushState ? (
          <Body variant="small" style={styles.muted}>
            {PUSH_STATE_LINES[pushState]}
          </Body>
        ) : null}
        {pushState === 'off' || pushState === 'failed' ? (
          <Button
            label={pushBusy ? 'Turning on…' : pushState === 'failed' ? 'Try again' : 'Turn on push notifications'}
            variant="outline"
            onPress={() => void turnOnPush()}
            disabled={pushBusy || !userId}
            style={styles.signOut}
          />
        ) : null}
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: layout.minTouchTarget,
  },
  switchLabel: {
    flex: 1,
  },
  muted: {
    color: colors.muted,
  },
  // Space above each Account-card button (Sign out, Export, Delete).
  signOut: {
    marginTop: spacing.sm,
  },
});
