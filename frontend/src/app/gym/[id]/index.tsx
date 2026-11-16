/**
 * A gym's page (B50: GYM-2, GYM-7) — opened from the gym directory, Communities' "Your gym",
 * Home's gym chip, or a profile's Gym section.
 *
 * What it shows, top to bottom:
 *   - the gym's name and address, and a line when it's your gym;
 *   - the viewer's way in or out: **Join this gym** (no gym yet), **Switch to this gym** (you're
 *     in another gym — asked first, naming the gym you'd leave, because you can belong to one gym
 *     at a time), or **Leave gym** (it's yours). Anyone can join any gym; there is no proof of
 *     membership;
 *   - a **Leaderboard** row (B52) opening the gym's board — each member's best verified squat,
 *     bench press and deadlift, in a men's and a women's division;
 *   - the **Members** list, newest first (tap a name for their profile);
 *   - the **Gym feed** — the members' posts, newest first, twenty at a time, as the same post
 *     cards Home uses (vote, comment, re-share, report, change your own post's audience).
 *
 * What it never shows: any setting, claim, edit or manage control. Gym pages are run by their
 * community; nobody — gym owners included — administers one (GYM-7). There is nothing to render
 * because no such path exists on the server either.
 *
 * What a viewer sees is the server's answer: every signed-in lifter can see a gym, its members
 * and its feed, and the feed then shows only posts that viewer could see anyway — public ones,
 * and followers-only ones of people they follow. The Gym feed is the ordinary feed read, narrowed
 * to the members; joining a gym never changes who sees a post.
 *
 * Gyms live on the server, so the page needs a connection; without one it says so, with Retry.
 * It reloads each time it comes into view, and after every join, switch or leave.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { confirmSwitchGym } from '@/components/gyms/confirmSwitchGym';
import { PostCard } from '@/components/social/PostCard';
import { usePostListActions } from '@/components/social/usePostListActions';
import { usePostPhotoSource } from '@/components/social/usePostPhotoSource';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { WorkoutVisibility } from '@/db/dao';
import { useAppDatabase } from '@/db/useAppDatabase';
import { getSupabase } from '@/lib/supabase';
import { appendPage, loadFeedPage, type FeedCursor, type FeedPost } from '@/social/feed';
import { GYM_MISSING, gymOf, GYMS_OFFLINE, joinGym, leaveGym, loadGym, loadGymMembers, type Gym, type GymMember, type GymResult } from '@/social/gyms';
import { personLabels } from '@/social/names';
import { withPostVisibility } from '@/social/postPrivacy';
import { colors, spacing } from '@/theme';

/** The gym, its roster and the viewer's own gym (null = none) — or why there is nothing to show. */
type PageState =
  | { status: 'loading' | 'error' | 'missing' }
  | { status: 'ready'; gym: Gym; members: GymMember[]; myGym: Gym | null };

/** The Gym feed's posts. */
type FeedState =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; posts: FeedPost[]; next: FeedCursor | null; loadingMore: boolean; moreFailed: boolean };

export default function GymScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const gymId = String(id);
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

  /** Reads the gym, its members and my own gym; then the first page of the Gym feed. */
  const load = useCallback(async () => {
    if (!me) return;
    const mine = ++generation.current;
    try {
      const gym = await loadGym(client, gymId);
      if (mine !== generation.current) return;
      if (!gym) {
        setPage({ status: 'missing' });
        return;
      }
      const [members, myGym] = await Promise.all([loadGymMembers(client, gymId), gymOf(client, me)]);
      if (mine !== generation.current) return;
      setPage({ status: 'ready', gym, members, myGym });
      const ids = members.map((m) => m.userId);
      setFeed((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
      const first = await loadFeedPage(client, me, ids, 'latest', null, null);
      if (mine !== generation.current) return;
      authors.current = ids;
      setFeed({ status: 'ready', posts: first.posts, next: first.next, loadingMore: false, moreFailed: false });
    } catch (error: unknown) {
      if (mine !== generation.current) return;
      console.warn('Gym: the page could not be loaded', error);
      // Keep what's on screen if a background re-read fails; an empty page shows the error.
      setPage((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
      setFeed((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [client, me, gymId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Scrolled to the bottom of the Gym feed: the next page, if there is one. */
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
      console.warn('Gym: the next page could not be loaded', error);
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

  /** Runs one gym action (join, switch, leave), then re-reads the page; a failure shows its sentence. */
  async function act(action: () => Promise<GymResult>): Promise<void> {
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
          <EmptyState icon="barbell-outline" message={GYM_MISSING} />
        ) : page.status === 'error' ? (
          <EmptyState
            icon="cloud-offline-outline"
            message={GYMS_OFFLINE}
            actionLabel="Retry"
            onAction={() => {
              setPage({ status: 'loading' });
              void load();
            }}
          />
        ) : (
          <Body variant="muted">Loading the gym…</Body>
        )}
      </Screen>
    );
  }

  const { gym, members, myGym } = page;
  const isMine = myGym?.id === gym.id;

  const header = (
    <View style={styles.header}>
      {backButton}
      <Heading>{gym.name}</Heading>
      <Body variant="small" style={styles.address}>
        {gym.address}
        {isMine ? ' · Your gym' : ''}
      </Body>

      {isMine ? (
        <Button
          label="Leave gym"
          variant="ghost"
          disabled={busy}
          onPress={() => me && void act(() => leaveGym(client, me))}
          style={styles.action}
        />
      ) : myGym ? (
        <Button
          label="Switch to this gym"
          disabled={busy}
          onPress={() => me && confirmSwitchGym(myGym.name, gym.name, () => void act(() => joinGym(client, me, gym.id)))}
          style={styles.action}
        />
      ) : (
        <Button
          label="Join this gym"
          disabled={busy}
          onPress={() => me && void act(() => joinGym(client, me, gym.id))}
          style={styles.action}
        />
      )}

      {message ? (
        <Body variant="small" style={styles.message}>
          {message}
        </Body>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${gym.name}'s leaderboard`}
        onPress={() => router.push({ pathname: '/gym/[id]/leaderboard', params: { id: gym.id } })}
        style={styles.leaderboardRow}
      >
        <Body style={styles.memberName}>Leaderboard</Body>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>

      <View style={styles.members}>
        <SectionLabel accessibilityRole="header">{members.length === 1 ? '1 member' : `${members.length} members`}</SectionLabel>
        {members.length === 0 ? <Body variant="small">No members yet — be the first.</Body> : null}
        {members.map((m) => {
          const who = personLabels({ username: m.username, displayName: m.displayName });
          return (
            <Pressable
              key={m.userId}
              accessibilityRole="button"
              accessibilityLabel={`Open ${who.name}'s profile`}
              onPress={() => router.push({ pathname: '/profile/[id]', params: { id: m.userId } })}
              style={styles.memberRow}
            >
              <Body style={styles.memberName}>{who.name}</Body>
              {who.handle ? <Body variant="small">{who.handle}</Body> : null}
            </Pressable>
          );
        })}
        <SectionLabel accessibilityRole="header" style={styles.feedLabel}>
          Gym feed
        </SectionLabel>
      </View>
    </View>
  );

  const empty =
    feed.status === 'error' ? (
      <EmptyState icon="cloud-offline-outline" message="The Gym feed needs a connection." actionLabel="Retry" onAction={() => void load()} />
    ) : feed.status === 'ready' ? (
      <EmptyState icon="barbell-outline" message="No posts from this gym’s members yet." />
    ) : (
      <Body variant="muted">Loading the Gym feed…</Body>
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
        testID="gym-feed"
        data={feed.status === 'ready' ? feed.posts : []}
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
  address: {
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
  },
  message: {
    marginTop: spacing.sm,
  },
  leaderboardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    marginTop: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  members: {
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
