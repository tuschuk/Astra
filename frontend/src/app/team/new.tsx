/**
 * New team (B36, TEAM-1) — reached from "Create a team" on Communities.
 *
 * What it shows: one Name box (at most 80 characters — the server's limit, said on screen once a
 * name goes past it), a note that the team starts open, and Create team.
 *
 * What the user can do: type a name and tap **Create team**. The team is created on the server
 * straight away (it needs a connection — teams aren't stored on the phone), the lifter becomes
 * its owner, and the screen is replaced by the new team's page, where the owner can switch it to
 * invite-only. **Back** returns to Communities without creating anything.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { assertValidTeamName, MAX_TEAM_NAME_LENGTH } from '@training-math';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase } from '@/lib/supabase';
import { createTeam } from '@/social/teams';
import { spacing } from '@/theme';

/**
 * True when the (trimmed) name breaks the server's length rule — asked of the shared check, so
 * the form and the server agree on how characters are counted. Empty is not reported (Create is
 * simply disabled).
 */
export function teamNameTooLong(trimmed: string): boolean {
  if (trimmed.length === 0) return false;
  try {
    assertValidTeamName(trimmed);
    return false;
  } catch {
    return true;
  }
}

export default function NewTeamScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const tooLong = teamNameTooLong(trimmed);
  const canCreate = trimmed.length > 0 && !tooLong && !busy && me !== null;

  /** Creates the team, then shows its page in place of this form. */
  async function create(): Promise<void> {
    if (!canCreate || !me) return;
    setBusy(true);
    setError(null);
    const result = await createTeam(client, me, name);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace({ pathname: '/team/[id]', params: { id: result.team.id } });
  }

  /** Back to Communities, or to it as a tab if there is nothing to go back to. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/communities');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>New team</Heading>
      <TextField
        label="Team name"
        placeholder="e.g. Dawn Patrol Barbell"
        value={name}
        onChangeText={setName}
        style={styles.field}
      />
      {tooLong ? <FormError message={`Names can be at most ${MAX_TEAM_NAME_LENGTH} characters.`} /> : null}
      <Body variant="muted" style={styles.note}>
        Your team starts open — anyone can join. You can switch it to invite-only from its page.
      </Body>
      {error ? <FormError message={error} /> : null}
      <Button label="Create team" onPress={() => void create()} disabled={!canCreate} style={styles.create} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  field: {
    marginTop: spacing.lg,
  },
  note: {
    marginTop: spacing.md,
  },
  create: {
    marginTop: spacing.lg,
  },
});
