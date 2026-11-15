/**
 * Invite lifters (B36, TEAM-1) — the team owner's screen, reached from "Invite lifters" on the
 * team page. This is how someone gets into an invite-only team.
 *
 * What it shows: a search box (the same people search as Find lifters — two letters or more, a
 * moment after typing stops), and each lifter found with one button: **Invite**, **Invited**
 * (tap to cancel the invite), or a "Member" label for someone already on the team.
 *
 * What the user can do: invite a lifter (they see "You're invited" on Communities and Home, and
 * on the team page, and can Join even while the team is invite-only), or cancel an invite.
 * Inviting works in open teams too — there it's just a nudge.
 *
 * Only the owner may invite; the server refuses anyone else (and an invite across a block), and
 * this screen says so instead of offering buttons that can't work. Needs a connection.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Body, Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase } from '@/lib/supabase';
import { MIN_SEARCH_LENGTH, searchLifters, type LifterResult } from '@/social/follows';
import { personLabels } from '@/social/names';
import { inviteToTeam, loadTeam, loadTeamMembers, removeInvite, teamInvitees, type Team } from '@/social/teams';
import { colors, radii, spacing } from '@/theme';

/** How long typing must pause before the search runs, in milliseconds. */
export const INVITE_SEARCH_DEBOUNCE_MS = 300;

/** The line a non-owner sees here. */
export const INVITE_OWNER_ONLY = 'Only the team’s owner can invite lifters.';

/** The team, who is on it, who is invited — or why that couldn't be read. */
type InviteSetup =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; team: Team | null; isOwner: boolean; memberIds: Set<string>; invited: Set<string> };

export default function InviteToTeamScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = String(id);
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);
  const [context, setContext] = useState<InviteSetup>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<{ query: string; results: LifterResult[] | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const tooShort = query.trim().length < MIN_SEARCH_LENGTH;

  /** Reads the team, its roster (to mark members and find out whether I'm the owner) and its invites. */
  const loadContext = useCallback(async () => {
    if (!me) return;
    try {
      const [team, members] = await Promise.all([loadTeam(client, teamId), loadTeamMembers(client, teamId)]);
      const isOwner = members.some((m) => m.userId === me && m.role === 'owner');
      const invited = isOwner ? await teamInvitees(client, teamId) : new Set<string>();
      setContext({ status: 'ready', team, isOwner, memberIds: new Set(members.map((m) => m.userId)), invited });
    } catch (error: unknown) {
      console.warn('Invite lifters: the team could not be loaded', error);
      setContext((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [client, me, teamId]);

  useFocusEffect(
    useCallback(() => {
      void loadContext();
    }, [loadContext]),
  );

  // Run the people search once typing pauses; a newer search makes an older answer irrelevant.
  useEffect(() => {
    if (!me || tooShort) return;
    let current = true;
    const timer = setTimeout(() => {
      searchLifters(client, me, query)
        .then((results) => {
          if (current) setAnswer({ query, results });
        })
        .catch((error: unknown) => {
          console.warn('Invite lifters: search failed', error);
          if (current) setAnswer({ query, results: null });
        });
    }, INVITE_SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, me, query, tooShort]);

  /** Invites or un-invites one lifter, then re-reads the invite list; a refusal shows its sentence. */
  async function toggleInvite(userId: string, invitedNow: boolean): Promise<void> {
    if (busyId) return;
    setBusyId(userId);
    setMessage(null);
    const result = invitedNow ? await removeInvite(client, teamId, userId) : await inviteToTeam(client, teamId, userId);
    setBusyId(null);
    if (!result.ok) setMessage(result.message);
    await loadContext();
  }

  /** Back to the team page. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/team/[id]', params: { id: teamId } });
  }

  const ready = context.status === 'ready' ? context : null;

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Invite lifters</Heading>
      {ready?.team ? <Body variant="muted">to {ready.team.name}</Body> : null}

      {context.status === 'loading' ? <Body variant="muted">Loading…</Body> : null}
      {context.status === 'error' ? (
        <Body variant="muted" style={styles.gap}>
          Inviting needs a connection. Check your signal and try again.
        </Body>
      ) : null}
      {ready && !ready.team ? (
        <Body variant="muted" style={styles.gap}>
          This team isn’t available.
        </Body>
      ) : null}
      {ready?.team && !ready.isOwner ? (
        <Body variant="muted" style={styles.gap}>
          {INVITE_OWNER_ONLY}
        </Body>
      ) : null}

      {ready?.team && ready.isOwner ? (
        <>
          <TextField
            label="Search lifters"
            placeholder="Name or username"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.search}
          />
          {message ? <Body variant="small">{message}</Body> : null}
          {tooShort ? (
            <Body variant="muted">Type at least {MIN_SEARCH_LENGTH} letters of a name or username.</Body>
          ) : answer?.query !== query ? (
            <Body variant="muted">Searching…</Body>
          ) : answer.results == null ? (
            <Body variant="muted">Searching needs a connection. Check your signal and try again.</Body>
          ) : answer.results.length === 0 ? (
            <Body variant="muted">No lifters match “{query.trim()}”.</Body>
          ) : (
            <View style={styles.list}>
              {answer.results.map((lifter) => {
                const who = personLabels(lifter);
                const isMember = ready.memberIds.has(lifter.id);
                const isInvited = ready.invited.has(lifter.id);
                return (
                  <View key={lifter.id} style={styles.row}>
                    <View style={styles.person}>
                      <Body style={styles.name}>{who.name}</Body>
                      {who.handle ? <Body variant="small">{who.handle}</Body> : null}
                    </View>
                    {isMember ? (
                      <Body variant="small">Member</Body>
                    ) : (
                      <Button
                        label={isInvited ? 'Invited' : 'Invite'}
                        variant={isInvited ? 'ghost' : 'outline'}
                        accessibilityLabel={isInvited ? `Cancel invite for ${who.name}` : `Invite ${who.name}`}
                        disabled={busyId !== null}
                        onPress={() => void toggleInvite(lifter.id, isInvited)}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  gap: {
    marginTop: spacing.lg,
  },
  search: {
    marginVertical: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  person: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
  },
});
