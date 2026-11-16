/**
 * ProgramVisibilitySection — "Who can see this" on the program page (PRG-4, B39).
 *
 * What it shows: four chips — Only you, Followers, Team, Published — with the program's current
 * choice lit, and one sentence under them saying who can see the program. When Team is chosen it
 * also lists the lifter's Teams, each with a tick showing whether the program is shared with it.
 *
 * What the lifter can do:
 *   - tap a chip to change who can see the program. This is saved on the phone at once and syncs
 *     later, so it works with no signal (the page passes `onSelect`, which writes through
 *     `programs/programs.ts`);
 *   - with Team chosen, tap a Team to share the program with it or stop sharing. That list lives
 *     on the server only, so it needs a connection: offline it says so, and the chips still work;
 *   - if the program is still shared with Teams the lifter has since left (shares stand when the
 *     author leaves), a line says how many, with **Stop sharing** to end them all.
 *
 * Hints: no Teams → "Join a team to share with it."; Team chosen but no Team ticked → a reminder
 * that only the lifter can see it until they pick one (a Team program shared with nobody is
 * private in effect — allowed, just explained).
 *
 * The server's security rules are what enforce all of this; the section only sets the choice.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { Button } from '@/components/ui/Button';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { FormError } from '@/components/ui/FormError';
import { Body, SectionLabel } from '@/components/ui/Text';
import type { ProgramVisibility } from '@/db/dao';
import { PROGRAM_VISIBILITY_ORDER, PROGRAM_VISIBILITY_WORDS } from '@/programs/programs';
import { listProgramShares, shareProgramWithTeam, unshareProgramFromTeam } from '@/social/programShares';
import { loadTeamsOf, TEAMS_OFFLINE, type Team } from '@/social/teams';
import { colors, layout, spacing } from '@/theme';

/** Shown under the Team list when the lifter isn't in any Team. */
export const NO_TEAMS_TO_SHARE = 'Join a team to share with it.';

/** Shown when Team is chosen but the program isn't shared with any Team yet. */
export const PICK_A_TEAM = 'Pick at least one team, or only you can see this.';

/** "Still shared with 1 team you left." / "…with 2 teams you left." */
export function leftSharesLine(count: number): string {
  return `Still shared with ${count} ${count === 1 ? 'team' : 'teams'} you left.`;
}

/** The four chips, built once from the words table. */
const VISIBILITY_OPTIONS: readonly ChoiceOption<ProgramVisibility>[] = PROGRAM_VISIBILITY_ORDER.map((value) => ({
  value,
  label: PROGRAM_VISIBILITY_WORDS[value].label,
  spoken: `${PROGRAM_VISIBILITY_WORDS[value].label}: ${PROGRAM_VISIBILITY_WORDS[value].meaning}`,
}));

interface ProgramVisibilitySectionProps {
  /** The program being edited. */
  programId: string;
  /** Its current visibility (as last read from the phone). */
  visibility: ProgramVisibility;
  /** Saves a new visibility (on the phone) and re-reads the page. */
  onSelect: (visibility: ProgramVisibility) => void;
  /** The signed-in lifter — whose Teams to list. */
  userId: string;
  /** The server connection, for the Team list. */
  client: SupabaseClient;
}

/** The Team list's state: reading; read (the lifter's Teams and which are ticked); or unreachable. */
type TeamsLoad = { status: 'loading' } | { status: 'ready'; teams: Team[]; shared: Set<string> } | { status: 'offline' };

export function ProgramVisibilitySection({ programId, visibility, onSelect, userId, client }: ProgramVisibilitySectionProps) {
  const [teamsLoad, setTeamsLoad] = useState<TeamsLoad>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  // The same "one change at a time" flag, read synchronously so two taps in one frame can't both start.
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const showTeams = visibility === 'team';

  // Reads the lifter's Teams and the program's current shares from the server — only once Team
  // is the choice (the other levels need no connection at all). An answer that arrives after the
  // lifter left Team, or the page closed, is dropped rather than shown. On a return to Team the
  // last list stays up until the fresh answer replaces it.
  useEffect(() => {
    if (!showTeams) return;
    let current = true;
    Promise.all([loadTeamsOf(client, userId), listProgramShares(client, programId)])
      .then(([memberships, shared]) => {
        if (current) setTeamsLoad({ status: 'ready', teams: memberships.map((m) => m.team), shared });
      })
      .catch((caught: unknown) => {
        console.warn('Program visibility: could not load teams', caught);
        if (current) setTeamsLoad({ status: 'offline' });
      });
    return () => {
      current = false;
    };
  }, [showTeams, client, userId, programId]);

  /**
   * Shares with or unshares from the given Teams (one tick, or every Team the lifter has left),
   * then updates the ticks for the ones that went through. The first refusal is shown.
   */
  async function change(teamIds: readonly string[], share: boolean): Promise<void> {
    if (running.current || teamsLoad.status !== 'ready') return;
    running.current = true;
    setBusy(true);
    setError(null);
    const done: string[] = [];
    let failure: string | null = null;
    for (const teamId of teamIds) {
      const result = share
        ? await shareProgramWithTeam(client, programId, teamId)
        : await unshareProgramFromTeam(client, programId, teamId);
      if (result.ok) done.push(teamId);
      else failure ??= result.message;
    }
    running.current = false;
    setBusy(false);
    setError(failure);
    setTeamsLoad((current) => {
      if (current.status !== 'ready') return current;
      const shared = new Set(current.shared);
      for (const teamId of done) {
        if (share) shared.add(teamId);
        else shared.delete(teamId);
      }
      return { ...current, shared };
    });
  }

  // Shares with Teams the lifter has since left (they stand — B39's product call — so the lifter
  // must be able to see and end them here).
  const memberTeamIds = teamsLoad.status === 'ready' ? new Set(teamsLoad.teams.map((t) => t.id)) : new Set<string>();
  const leftShares = teamsLoad.status === 'ready' ? [...teamsLoad.shared].filter((id) => !memberTeamIds.has(id)) : [];
  const listedShareCount = teamsLoad.status === 'ready' ? teamsLoad.shared.size - leftShares.length : 0;

  return (
    <View style={styles.section}>
      <SectionLabel>Who can see this</SectionLabel>
      <ChoiceChips
        options={VISIBILITY_OPTIONS}
        selected={visibility}
        onSelect={(next) => {
          // A new choice starts clean: an old share refusal doesn't reappear on a return to Team.
          setError(null);
          onSelect(next);
        }}
      />
      <Body variant="muted">{PROGRAM_VISIBILITY_WORDS[visibility].meaning}</Body>

      {showTeams ? (
        <View style={styles.teams}>
          {teamsLoad.status === 'offline' ? <Body variant="muted">{TEAMS_OFFLINE}</Body> : null}
          {teamsLoad.status === 'ready' && teamsLoad.teams.length === 0 ? (
            <Body variant="muted">{NO_TEAMS_TO_SHARE}</Body>
          ) : null}
          {teamsLoad.status === 'ready'
            ? teamsLoad.teams.map((team) => {
                const isShared = teamsLoad.shared.has(team.id);
                return (
                  <Pressable
                    key={team.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`Share with ${team.name}`}
                    accessibilityState={{ checked: isShared, disabled: busy }}
                    disabled={busy}
                    onPress={() => void change([team.id], !isShared)}
                    style={({ pressed }) => [styles.teamRow, pressed && styles.pressed]}
                  >
                    <View style={[styles.box, isShared && styles.boxOn]} />
                    <Body style={styles.teamName}>{team.name}</Body>
                  </Pressable>
                );
              })
            : null}
          {leftShares.length > 0 ? (
            <View style={styles.leftRow}>
              <Body variant="muted" style={styles.teamName}>
                {leftSharesLine(leftShares.length)}
              </Body>
              <Button
                label="Stop sharing"
                variant="ghost"
                disabled={busy}
                accessibilityLabel="Stop sharing with teams you left"
                onPress={() => void change(leftShares, false)}
              />
            </View>
          ) : null}
          {teamsLoad.status === 'ready' && teamsLoad.teams.length > 0 && listedShareCount === 0 && leftShares.length === 0 ? (
            <Body variant="muted">{PICK_A_TEAM}</Body>
          ) : null}
          <FormError message={error} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  teams: {
    gap: spacing.xs,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
  },
  box: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceDeep,
  },
  boxOn: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
  },
  teamName: {
    flex: 1,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
});
