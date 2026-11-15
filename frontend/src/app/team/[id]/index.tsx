/**
 * A team's page (B36: TEAM-1, TEAM-2) — opened from Home's team chips, Communities, or a
 * profile's Teams section.
 *
 * What it shows, top to bottom:
 *   - the team's name and how it lets people in ("Open — anyone can join" / "Invite only");
 *   - the viewer's way in or out: **Join** (open team), **You're invited — Join** (invite-only
 *     team that invited you), a line saying the team is invite-only (no invite), or **Leave**
 *     for a member. The owner can't leave — a team always keeps its owner;
 *   - for the owner only: the **join-mode switch** (Open | Invite only) and **Invite lifters**;
 *   - (B37) for members: the notice that the team's coaches can see their training log, any
 *     **program a coach assigned** them (View → Start / Dismiss), and the **Coach's corner** —
 *     the coaches' pushes, newest first (announcements, and programs / workouts that open in a
 *     sheet to save or start). Coaches (the owner counts as one) also get **Announce**, **Push a
 *     program** and **Push a workout**, and can remove their own pushes;
 *   - the **Members** list (tap a name for their profile — a coach sees the member's whole
 *     training log there). The owner can **Make coach** / **Remove coach**; coaches can **Assign
 *     a program** to a member and see or **Revoke** what each member has been assigned;
 *   - the **Team feed** — the members' posts, newest first, twenty at a time, as the same post
 *     cards Home uses (vote, comment, re-share, report, change your own post's audience).
 *
 * What a viewer sees is the server's answer, never decided here: an open team's members and feed
 * are visible to anyone signed in (the feed then shows only posts that viewer could see anyway —
 * public ones, and followers-only ones of people they follow); an invite-only team you aren't in
 * shows only its name and "Join to see the team's activity". The Team feed never widens who sees
 * a post: it is the ordinary feed read, narrowed to the members.
 *
 * Teams live on the server, so the page needs a connection; without one it says so, with Retry.
 * It reloads each time it comes into view, and after every join, leave or switch.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { PostCard } from '@/components/social/PostCard';
import { usePostListActions } from '@/components/social/usePostListActions';
import { usePostPhotoSource } from '@/components/social/usePostPhotoSource';
import { COACH_LOG_NOTICE, useTeamCoaching } from '@/components/teams/useTeamCoaching';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { WorkoutVisibility } from '@/db/dao';
import { useAppDatabase } from '@/db/useAppDatabase';
import { getSupabase } from '@/lib/supabase';
import { appendPage, loadFeedPage, type FeedCursor, type FeedPost } from '@/social/feed';
import { personLabels } from '@/social/names';
import { withPostVisibility } from '@/social/postPrivacy';
import type { TeamPost } from '@/social/teamCoaching';
import {
  isCoachRole,
  joinTeam,
  leaveTeam,
  loadTeam,
  loadTeamMembers,
  myInvites,
  roleLabel,
  setJoinMode,
  TEAMS_OFFLINE,
  type Team,
  type TeamJoinMode,
  type TeamMember,
  type TeamResult,
} from '@/social/teams';
import { colors, spacing } from '@/theme';
import { postDateLabel } from '@/workout/format';

/** The owner's switch (TEAM-1). */
const MODE_OPTIONS: readonly ChoiceOption<TeamJoinMode>[] = [
  { value: 'open', label: 'Open', spoken: 'Open: anyone can join' },
  { value: 'invite', label: 'Invite only', spoken: 'Invite only: only invited lifters can join' },
];

/** The line a non-member sees on an invite-only team. */
export const TEAM_CLOSED_LINE = 'This team is invite-only. Join to see the team’s activity.';

/** The line shown when the team doesn't exist (a bad link). */
export const TEAM_MISSING = 'This team isn’t available.';

/** The team, its visible roster and whether I hold an invite — or why there is none to show. */
type PageState =
  | { status: 'loading' | 'error' | 'missing' }
  | { status: 'ready'; team: Team; members: TeamMember[]; invited: boolean };

/** The Team feed's posts. */
type FeedState =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; posts: FeedPost[]; next: FeedCursor | null; loadingMore: boolean; moreFailed: boolean };

export default function TeamScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = String(id);
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);
  const { db } = useAppDatabase();
  const photoSource = usePostPhotoSource();

  const [page, setPage] = useState<PageState>({ status: 'loading' });
  const [feed, setFeed] = useState<FeedState>({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Whose posts the feed was loaded for, so later pages ask for the same people.
  const authors = useRef<string[]>([]);
  // Each load gets a number; an answer that lands after a newer load started is ignored.
  const generation = useRef(0);
  const pageInFlight = useRef(false);
  // The latest `load`, for the coaching hook's "something changed — re-read" (B37).
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const coaching = useTeamCoaching({ client, db, me, teamId, onChanged: () => void loadRef.current() });
  const reloadCoaching = coaching.reload;

  /**
   * Reads the team, the roster the server lets me see and my invite; then, if the team's
   * activity is visible to me (I'm a member, or it's open), the first page of the Team feed.
   */
  const load = useCallback(async () => {
    if (!me) return;
    const mine = ++generation.current;
    try {
      const team = await loadTeam(client, teamId);
      if (mine !== generation.current) return;
      if (!team) {
        setPage({ status: 'missing' });
        return;
      }
      const [members, invites] = await Promise.all([loadTeamMembers(client, teamId), myInvites(client, me)]);
      if (mine !== generation.current) return;
      setPage({ status: 'ready', team, members, invited: invites.some((t) => t.id === teamId) });
      const myRow = members.find((m) => m.userId === me);
      const isMember = myRow !== undefined;
      // Coaching (B37): its own failure never blanks the rest of the page.
      reloadCoaching(isMember, isCoachRole(myRow?.role ?? null)).catch((error: unknown) =>
        console.warn('Team: coaching could not be loaded', error),
      );
      if (!isMember && team.joinMode !== 'open') {
        setFeed({ status: 'idle' });
        return;
      }
      const ids = members.map((m) => m.userId);
      setFeed((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
      const first = await loadFeedPage(client, me, ids, 'latest', null, null);
      if (mine !== generation.current) return;
      authors.current = ids;
      setFeed({ status: 'ready', posts: first.posts, next: first.next, loadingMore: false, moreFailed: false });
    } catch (error: unknown) {
      if (mine !== generation.current) return;
      console.warn('Team: the page could not be loaded', error);
      // Keep what's on screen if a background re-read fails; an empty page shows the error.
      setPage((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
      setFeed((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [client, me, teamId, reloadCoaching]);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Scrolled to the bottom of the Team feed: the next page, if there is one. */
  async function loadMore(): Promise<void> {
    if (!me || feed.status !== 'ready' || feed.next == null || pageInFlight.current) return;
    const mine = generation.current;
    const after = feed.next;
    pageInFlight.current = true;
    setFeed((prev) => (prev.status === 'ready' ? { ...prev, loadingMore: true, moreFailed: false } : prev));
    try {
      const next = await loadFeedPage(client, me, authors.current, 'latest', null, after);
      if (mine === generation.current) {
        setFeed((prev) =>
          prev.status === 'ready' ? { ...prev, posts: appendPage(prev.posts, next.posts), next: next.next, loadingMore: false } : prev,
        );
      }
    } catch (error: unknown) {
      console.warn('Team: the next page could not be loaded', error);
      if (mine === generation.current) {
        setFeed((prev) => (prev.status === 'ready' ? { ...prev, loadingMore: false, moreFailed: true } : prev));
      }
    } finally {
      pageInFlight.current = false;
    }
  }

  /** Pull-to-refresh: the same full reload, with the spinner showing. */
  async function pullToRefresh(): Promise<void> {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  /** Runs one team action (join, leave, switch), then re-reads the page; a refusal shows its sentence. */
  async function act(action: () => Promise<TeamResult>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setMessage(result.message);
    await load();
  }

  const onVisibilityChanged = useCallback(
    (postId: string, next: WorkoutVisibility) =>
      setFeed((prev) => (prev.status === 'ready' ? { ...prev, posts: withPostVisibility(prev.posts, postId, next) } : prev)),
    [],
  );
  const actions = usePostListActions({ client, db, me, onVisibilityChanged });

  /** Back to wherever the page was opened from, or Communities. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/communities');
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (page.status !== 'ready') {
    return (
      <Screen>
        {backButton}
        {page.status === 'missing' ? (
          <EmptyState icon="people-outline" message={TEAM_MISSING} />
        ) : page.status === 'error' ? (
          <EmptyState
            icon="cloud-offline-outline"
            message={TEAMS_OFFLINE}
            actionLabel="Retry"
            onAction={() => {
              setPage({ status: 'loading' });
              void load();
            }}
          />
        ) : (
          <Body variant="muted">Loading the team…</Body>
        )}
      </Screen>
    );
  }

  const { team, members, invited } = page;
  const myRole = members.find((m) => m.userId === me)?.role ?? null;
  const isOwner = myRole === 'owner';
  const isCoach = isCoachRole(myRole);
  const canSee = myRole !== null || team.joinMode === 'open';

  /** One push in the Coach's corner: the text, or a card that opens the program / workout. */
  function renderPush(post: TeamPost) {
    const who = personLabels(post.author).name;
    const opens = post.kind !== 'announcement';
    const title =
      post.kind === 'announcement'
        ? post.body
        : post.kind === 'program'
          ? `Program: ${(post.programId && coaching.programName(post.programId)) ?? 'No longer available'}`
          : `Workout: ${(post.programWorkoutId && coaching.workoutName(post.programWorkoutId)) ?? 'No longer available'}`;
    const card = (
      <Card style={styles.push}>
        <Body style={styles.pushText}>{title}</Body>
        <Body variant="small">
          {who} · {postDateLabel(post.createdAt)}
        </Body>
        {post.authorId === me ? (
          <Button label="Remove" variant="ghost" disabled={coaching.busy} onPress={() => coaching.deletePost(post)} />
        ) : null}
      </Card>
    );
    return opens ? (
      <Pressable
        key={post.id}
        accessibilityRole="button"
        accessibilityLabel={`Open ${title}`}
        onPress={() => coaching.openPost(post)}
      >
        {card}
      </Pressable>
    ) : (
      <View key={post.id}>{card}</View>
    );
  }

  const header = (
    <View style={styles.header}>
      {backButton}
      <Heading>{team.name}</Heading>
      <Body variant="small" style={styles.mode}>
        {team.joinMode === 'open' ? 'Open — anyone can join' : 'Invite only'}
        {myRole ? ` · You: ${roleLabel(myRole)}` : ''}
      </Body>

      {myRole === null ? (
        team.joinMode === 'open' || invited ? (
          <Button
            label={invited ? 'You’re invited — Join' : 'Join team'}
            disabled={busy}
            onPress={() => me && void act(() => joinTeam(client, me, teamId))}
            style={styles.action}
          />
        ) : (
          <Body variant="muted" style={styles.action}>
            {TEAM_CLOSED_LINE}
          </Body>
        )
      ) : isOwner ? null : (
        <Button
          label="Leave team"
          variant="ghost"
          disabled={busy}
          onPress={() => me && void act(() => leaveTeam(client, me, teamId))}
          style={styles.action}
        />
      )}

      {isOwner ? (
        <View style={styles.owner}>
          <SectionLabel size="small">Who can join</SectionLabel>
          <ChoiceChips
            options={MODE_OPTIONS}
            selected={team.joinMode}
            disabled={busy}
            fill
            onSelect={(mode) => {
              if (mode !== team.joinMode) void act(() => setJoinMode(client, teamId, mode));
            }}
          />
          <Button
            label="Invite lifters"
            variant="ghost"
            onPress={() => router.push({ pathname: '/team/[id]/invite', params: { id: teamId } })}
          />
        </View>
      ) : null}

      {message || coaching.message ? (
        <Body variant="small" style={styles.message}>
          {message ?? coaching.message}
        </Body>
      ) : null}

      {myRole ? (
        <Body variant="small" style={styles.message}>
          {COACH_LOG_NOTICE}
        </Body>
      ) : null}

      {coaching.myAssignments.map((a) => (
        <Card key={a.programId} accent style={styles.assignment}>
          <Body style={styles.pushText}>Your coach assigned {coaching.programName(a.programId) ?? 'a program'}</Body>
          <View style={styles.rowActions}>
            <Button label="View" onPress={() => coaching.openAssignment(a)} disabled={coaching.busy} />
            <Button label="Dismiss" variant="ghost" onPress={() => coaching.dismissAssignment(a)} disabled={coaching.busy} />
          </View>
        </Card>
      ))}

      {myRole ? (
        <View style={styles.members}>
          <SectionLabel>Coach’s corner</SectionLabel>
          {isCoach ? (
            <View style={styles.rowActions}>
              <Button label="Announce" variant="outline" onPress={coaching.startPushAnnouncement} />
              <Button label="Push a program" variant="outline" onPress={coaching.startPushProgram} />
              <Button label="Push a workout" variant="outline" onPress={coaching.startPushWorkout} />
            </View>
          ) : null}
          {coaching.posts.length === 0 ? (
            <Body variant="small">Nothing from the coaches yet.</Body>
          ) : (
            coaching.posts.map(renderPush)
          )}
        </View>
      ) : null}

      {canSee ? (
        <View style={styles.members}>
          <SectionLabel>{members.length === 1 ? '1 member' : `${members.length} members`}</SectionLabel>
          {members.map((m) => {
            const who = personLabels({ username: m.username, displayName: m.displayName });
            const assigned = isCoach ? coaching.assignmentsOf(m.userId) : [];
            return (
              <View key={m.userId} style={styles.memberBlock}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${who.name}'s profile`}
                  onPress={() => router.push({ pathname: '/profile/[id]', params: { id: m.userId } })}
                  style={styles.memberRow}
                >
                  <Body style={styles.memberName}>{who.name}</Body>
                  <Body variant="small">{roleLabel(m.role)}</Body>
                </Pressable>
                {(isOwner && m.role !== 'owner') || (isCoach && m.userId !== me) ? (
                  <View style={styles.rowActions}>
                    {isOwner && m.role !== 'owner' ? (
                      <Button
                        label={m.role === 'coach' ? 'Remove coach' : 'Make coach'}
                        variant="ghost"
                        disabled={coaching.busy}
                        onPress={() => coaching.setRole(m.userId, m.role === 'coach' ? 'member' : 'coach')}
                      />
                    ) : null}
                    {isCoach && m.userId !== me ? (
                      <Button
                        label="Assign a program"
                        variant="ghost"
                        accessibilityLabel={`Assign a program to ${who.name}`}
                        onPress={() => coaching.startAssign(m.userId)}
                      />
                    ) : null}
                  </View>
                ) : null}
                {assigned.map((a) => (
                  <View key={a.programId} style={styles.rowActions}>
                    <Body variant="small">Assigned: {coaching.programName(a.programId) ?? 'a program'}</Body>
                    <Button
                      label="Revoke"
                      variant="ghost"
                      disabled={coaching.busy}
                      onPress={() => coaching.revokeAssignment(a)}
                    />
                  </View>
                ))}
              </View>
            );
          })}
          <SectionLabel style={styles.feedLabel}>Team feed</SectionLabel>
        </View>
      ) : null}
    </View>
  );

  const empty = !canSee ? undefined : feed.status === 'error' ? (
    <EmptyState
      icon="cloud-offline-outline"
      message="The Team feed needs a connection."
      actionLabel="Retry"
      onAction={() => void load()}
    />
  ) : feed.status === 'ready' ? (
    <EmptyState icon="barbell-outline" message="No posts from this team’s members yet." />
  ) : (
    <Body variant="muted">Loading the Team feed…</Body>
  );

  const footer =
    feed.status === 'ready' && feed.moreFailed ? (
      <View style={styles.footer}>
        <Body variant="small">Couldn’t load more posts.</Body>
        <Button label="Try again" variant="ghost" onPress={() => void loadMore()} />
      </View>
    ) : feed.status === 'ready' && feed.loadingMore ? (
      <Body variant="small" style={styles.footer}>
        Loading more…
      </Body>
    ) : undefined;

  return (
    <Screen scroll={false}>
      <FlatList
        testID="team-feed"
        data={canSee && feed.status === 'ready' ? feed.posts : []}
        keyExtractor={(post) => post.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            viewerId={me}
            photoSource={photoSource}
            onVote={actions.vote}
            onChangeVisibility={actions.changeVisibility}
            onOpenComments={actions.openComments}
            onOpenProfile={actions.openProfile}
            onReport={actions.reportPost}
            onReshare={actions.reshare}
            onShareWorkout={actions.shareWorkout}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} tintColor={colors.accent} />
        }
        showsVerticalScrollIndicator={false}
      />
      {coaching.modals}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.lg,
  },
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  mode: {
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
  },
  owner: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  message: {
    marginTop: spacing.sm,
  },
  members: {
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  memberBlock: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  assignment: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  push: {
    gap: spacing.xs,
  },
  pushText: {
    color: colors.text,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  memberName: {
    color: colors.text,
  },
  feedLabel: {
    marginTop: spacing.xl,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
});
