/**
 * Communities — Teams (B36: TEAM-1, TEAM-2) and, later, Gyms (GYM-1..GYM-10).
 *
 * What it shows, under Teams:
 *   - **Your teams** — every team you are in, with its mode and your role; tap one for its page
 *     (its roster and Team feed);
 *   - **Invites** — teams whose owner invited you: "Join" (the invite is used up) or "Decline";
 *   - **Create a team** — opens the create form (a team starts open; you become its owner);
 *   - **Find teams** — type two letters or more to search teams by name; each result opens its
 *     page, and a team you could join right now (open, or invite-only with your invite) has a
 *     Join button right on the row.
 * The Gyms half is still a card explaining what will live there.
 *
 * Teams live on the server, so this screen needs a connection; without one it says so, with
 * Retry. Who may join what is decided by the server's security rules (an invite-only team refuses
 * a join without an invite); this screen only asks and shows the answer. Everything reloads when
 * the tab comes back into view (after creating, joining or leaving a team elsewhere).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { TeamListItem } from '@/components/teams/TeamListItem';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase } from '@/lib/supabase';
import { MIN_SEARCH_LENGTH } from '@/social/follows';
import {
  joinTeam,
  loadTeamsOf,
  myInvites,
  removeInvite,
  searchTeams,
  TEAMS_OFFLINE,
  type Team,
  type TeamMembership,
  type TeamResult,
} from '@/social/teams';
import { spacing } from '@/theme';

/** How long typing must pause before the team search runs, in milliseconds. */
export const TEAM_SEARCH_DEBOUNCE_MS = 300;

/** Your teams and invites: still loading, unreachable, or loaded. */
type Overview =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; teams: TeamMembership[]; invites: Team[] };

export default function CommunitiesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);
  const [overview, setOverview] = useState<Overview>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // The latest search answer and the text it answers (`results` null = the search failed).
  const [answer, setAnswer] = useState<{ query: string; results: Team[] | null } | null>(null);
  const tooShort = query.trim().length < MIN_SEARCH_LENGTH;

  /** Reads your teams and invites. Keeps what's shown if a background re-read fails. */
  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [teams, invites] = await Promise.all([loadTeamsOf(client, me), myInvites(client, me)]);
      setOverview({ status: 'ready', teams, invites });
    } catch (error: unknown) {
      console.warn('Communities: teams could not be loaded', error);
      setOverview((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [client, me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Run the team search once typing pauses; a newer search makes an older answer irrelevant.
  useEffect(() => {
    if (tooShort) return;
    let current = true;
    const timer = setTimeout(() => {
      searchTeams(client, query)
        .then((results) => {
          if (current) setAnswer({ query, results });
        })
        .catch((error: unknown) => {
          console.warn('Communities: team search failed', error);
          if (current) setAnswer({ query, results: null });
        });
    }, TEAM_SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, query, tooShort]);

  /** Runs one team action (join, decline), then re-reads the lists; a refusal shows its sentence. */
  async function act(action: () => Promise<TeamResult>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setMessage(result.message);
    await load();
  }

  const openTeam = (teamId: string) => router.push({ pathname: '/team/[id]', params: { id: teamId } });
  const myTeamIds = new Set(overview.status === 'ready' ? overview.teams.map((m) => m.team.id) : []);
  const invitedIds = new Set(overview.status === 'ready' ? overview.invites.map((t) => t.id) : []);
  /** A search result I could join right now: not mine yet, and open — or invite-only with my invite. */
  const joinable = (team: Team) => !myTeamIds.has(team.id) && (team.joinMode === 'open' || invitedIds.has(team.id));

  return (
    <Screen>
      <Heading>Communities</Heading>
      <Body variant="muted" style={styles.lede}>
        Train with your people.
      </Body>

      <View style={styles.sectionHeader}>
        <SectionLabel>Teams</SectionLabel>
        <Button label="Create a team" variant="ghost" onPress={() => router.push('/team/new')} />
      </View>

      {overview.status === 'error' ? (
        <EmptyState
          icon="cloud-offline-outline"
          message={TEAMS_OFFLINE}
          actionLabel="Retry"
          onAction={() => {
            setOverview({ status: 'loading' });
            void load();
          }}
        />
      ) : overview.status === 'loading' ? (
        <Body variant="muted">Loading your teams…</Body>
      ) : (
        <View style={styles.list}>
          {overview.invites.length > 0 ? (
            <>
              <SectionLabel size="small">Invites</SectionLabel>
              {overview.invites.map((team) => (
                <TeamListItem
                  key={`invite:${team.id}`}
                  team={team}
                  onPress={() => openTeam(team.id)}
                  actions={[
                    { label: 'Join', disabled: busy, onPress: () => me && void act(() => joinTeam(client, me, team.id)) },
                    { label: 'Decline', disabled: busy, onPress: () => me && void act(() => removeInvite(client, team.id, me)) },
                  ]}
                />
              ))}
            </>
          ) : null}
          <SectionLabel size="small">Your teams</SectionLabel>
          {overview.teams.length === 0 ? (
            <Card>
              <Body>
                Create a team or join one — share a feed with your training partners, your club or your
                coach&apos;s athletes.
              </Body>
            </Card>
          ) : (
            overview.teams.map(({ team, role }) => (
              <TeamListItem key={team.id} team={team} role={role} onPress={() => openTeam(team.id)} />
            ))
          )}
        </View>
      )}
      {message ? (
        <Body variant="small" style={styles.message}>
          {message}
        </Body>
      ) : null}

      <SectionLabel size="small" style={styles.findLabel}>
        Find teams
      </SectionLabel>
      <TextField
        label="Search teams"
        placeholder="Team name"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        style={styles.search}
      />
      {tooShort ? (
        <Body variant="muted">Type at least {MIN_SEARCH_LENGTH} letters of a team’s name.</Body>
      ) : answer?.query !== query ? (
        <Body variant="muted">Searching…</Body>
      ) : answer.results == null ? (
        <Body variant="muted">Searching needs a connection. Check your signal and try again.</Body>
      ) : answer.results.length === 0 ? (
        <Body variant="muted">No teams match “{query.trim()}”.</Body>
      ) : (
        <View style={styles.list}>
          {answer.results.map((team) => (
            <TeamListItem
              key={`found:${team.id}`}
              team={team}
              onPress={() => openTeam(team.id)}
              actions={
                joinable(team) && me
                  ? [{ label: 'Join', disabled: busy, onPress: () => void act(() => joinTeam(client, me, team.id)) }]
                  : []
              }
            />
          ))}
        </View>
      )}

      <SectionLabel style={styles.sectionLabel}>Gyms</SectionLabel>
      <Card>
        <Body>
          Join your gym to enter its leaderboard: squat, bench and deadlift PRs, video-verified by
          the community.
        </Body>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.sm,
  },
  sectionHeader: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  list: {
    gap: spacing.sm,
  },
  message: {
    marginTop: spacing.sm,
  },
  findLabel: {
    marginTop: spacing.xl,
  },
  search: {
    marginVertical: spacing.md,
  },
  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
});
