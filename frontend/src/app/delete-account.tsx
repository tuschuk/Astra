/**
 * Delete account (B32, NFR-6) — reached from Settings → Account → Delete account.
 *
 * What it shows: which account is signed in (so there is no doubt which one goes), a plain
 * statement of what deleting removes — the account and everything in it, workouts, sets, PRs,
 * posts, photos, settings, forever, including a workout in progress on this phone — and a
 * suggestion to export first ("Export your data first" goes back to Settings, where Export lives).
 *
 * What the lifter can do: type DELETE in the box, which unlocks the Delete my account button.
 * Pressing it asks the server to delete the account. Only when the server answers "deleted"
 * does the phone wipe its own copy (`wipeDeviceData`) — signing out first, which takes the app
 * to the sign-in screen. Anything else (no signal, a refusal, a server error) shows a calm line
 * and changes nothing, on the server or the phone; the lifter can simply try again. (If the
 * phone deleted the account but somehow failed to sign out, the screen says to reopen Astra.)
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { requestAccountDeletion, DELETE_CONFIRMATION_WORD } from '@/account/deleteAccount';
import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { wipeDeviceData } from '@/db/wipeDevice';
import { getSupabase } from '@/lib/supabase';
import { colors, spacing } from '@/theme';

/** The statement of what goes, shown above the confirmation box. */
export const DELETE_WARNING =
  'Deleting your account removes it and everything in it — every workout, set and PR, your posts and photos, ' +
  'your profile and settings — from Astra for good. It can’t be undone. A workout in progress on this phone goes too.';

/** The nudge to keep a copy first (its button goes back to Settings, where Export lives). */
export const EXPORT_FIRST_LINE = 'Want a copy first? Export your data from Settings before you delete.';

/** Shown in the rare case the account was deleted but this phone couldn't sign out. */
export const DELETED_REOPEN_LINE = 'Your account was deleted. Close Astra and open it again.';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const client = useMemo(() => getSupabase(), []);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server deleted the account but this phone failed to sign out (rare; see handleDelete).
  const [done, setDone] = useState(false);

  const confirmed = typed.trim() === DELETE_CONFIRMATION_WORD;

  /** Asks the server to delete the account; wipes the phone only after it says it did. */
  async function handleDelete(): Promise<void> {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);
    const result = await requestAccountDeletion(client);
    if (!result.ok) {
      setDeleting(false);
      setError(result.message);
      return;
    }
    // Signing out (the wipe's first step) normally moves the app to sign-in and closes this
    // screen. If this phone somehow couldn't sign out, the account is still gone: say so, and
    // keep the button locked — there is nothing left to delete.
    const { signedOut } = await wipeDeviceData(signOut);
    if (!signedOut) {
      setDone(true);
      setError(DELETED_REOPEN_LINE);
    }
  }

  /** Back to Settings (opened afresh if there is nothing to go back to). */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} disabled={deleting} style={styles.back} />
      <Heading>Delete account</Heading>

      <Card style={styles.card}>
        <SectionLabel size="small">Signed in as</SectionLabel>
        <Body>{session?.user.email ?? 'Signed in'}</Body>
      </Card>

      <Card style={[styles.card, styles.gap]}>
        <Body>{DELETE_WARNING}</Body>
        <Body variant="small" style={styles.muted}>
          {EXPORT_FIRST_LINE}
        </Body>
        <Button label="Export your data first" variant="ghost" onPress={back} disabled={deleting} />
        <TextField
          label={`Type ${DELETE_CONFIRMATION_WORD} to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!deleting}
        />
        <Button
          label={deleting && !done ? 'Deleting…' : 'Delete my account'}
          onPress={() => void handleDelete()}
          disabled={!confirmed || deleting}
          style={styles.delete}
        />
        <FormError message={error} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  card: {
    gap: spacing.sm,
  },
  gap: {
    marginTop: spacing.md,
  },
  muted: {
    color: colors.muted,
  },
  delete: {
    marginTop: spacing.sm,
  },
});
