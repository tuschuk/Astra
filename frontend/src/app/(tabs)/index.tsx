/**
 * Home — the social feed (SOC-1).
 *
 * What it shows: posts from the lifters you follow, and your own, as post cards
 * (components/social/PostCard) — shared workouts, and (B22) progress-pic and PR photos, each
 * photo fetched with the viewer's sign-in so the server decides who sees it. Twenty at a time;
 * scrolling to the bottom loads the next twenty, and pulling down refreshes. The feed also
 * refreshes each time Home comes back into view (after following someone on Find lifters, their
 * posts are there; after Share a photo, yours is, once it has uploaded).
 *
 * What the user can do: read the feed, pull to refresh, open Share a photo (B22) to post a
 * progress pic or PR photo, and open Find lifters to search for people and follow them. On each
 * card (B23): upvote or downvote (no downvote on upvote-only posts such as Physique Check), and
 * open the post's comments. Votes go straight to the server; the card shows the change at once
 * and takes it back if refused.
 *
 * Order and flair (B24): under "Your feed", Latest | Hot picks newest first or the server's
 * vote ranking (SOC-11), and a row of flair chips — All plus one per flair on the phone — shows
 * only posts of that flair (SOC-9). Both are remembered on this phone for this account
 * (social/feedPrefs.ts) and come back after a relaunch; Home reads them before its first request
 * so it opens straight into the remembered feed. A remembered flair the phone no longer lists
 * reads as All, so the feed is never filtered by a chip the lifter can't see.
 *
 * When there is nothing to show:
 *   - filtered to a flair with no posts → "No <flair> posts yet." with Show all posts (B24);
 *   - following nobody and no posts of your own → an invitation to find lifters, plus the
 *     existing "log a workout" action;
 *   - following people who haven't posted → the same invitation, worded for that;
 *   - no connection (or the request failed) → "The feed needs a connection" with Retry. The feed
 *     is read from the server (other people's workouts are never stored on the phone), so it is
 *     the one screen that needs signal; logging and the Tool Kit keep working offline.
 *
 * Who can see which post is decided by the server's security rules, never here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { PostCard } from '@/components/social/PostCard';
import { ChoiceChips, type ChoiceOption } from '@/components/toolkit/ChoiceChips';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { FlairRow } from '@/db/dao';
import { readFlairs } from '@/db/flairs';
import { useAppDatabase } from '@/db/useAppDatabase';
import { getSupabase, readSupabaseConfig, type SupabaseConfig } from '@/lib/supabase';
import { appendPage, feedAuthorIds, loadFeedPage, type FeedCursor, type FeedPost } from '@/social/feed';
import { getCachedFeedPrefs, loadFeedPrefs, saveFeedPrefs, type FeedPrefs, type FeedSort } from '@/social/feedPrefs';
import { postImageSource } from '@/social/postImages';
import { castVote, clearVote, type VoteResult, type VoteValue } from '@/social/votes';
import { colors, spacing } from '@/theme';

/**
 * What Home is showing: the first load, a failed load, or the feed itself. A ready feed also
 * records the order and flair it was loaded in, so "load more" continues that same list even
 * if the lifter has just tapped a different chip.
 */
type FeedState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      posts: FeedPost[];
      next: FeedCursor | null;
      followsSomeone: boolean;
      sort: FeedSort;
      flairId: string | null;
    };

/** The order toggle's two chips (B24, SOC-11). */
const SORT_OPTIONS: readonly ChoiceOption<FeedSort>[] = [
  { value: 'latest', label: 'Latest', spoken: 'Latest posts first' },
  { value: 'hot', label: 'Hot', spoken: 'Hot posts first, ranked by votes' },
];

/** The flair row's value for "every flair" (no flair id is ever empty). */
const ALL_FLAIRS = '';

export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);
  // How photo posts' pictures are fetched (B22): as this viewer, so the server's rules decide.
  const accessToken = session?.access_token ?? null;
  const photoSource = useMemo(() => {
    let config: SupabaseConfig | null = null;
    try {
      config = readSupabaseConfig();
    } catch {
      // Only reachable unconfigured (Jest): in the app a missing address already failed
      // `getSupabase()` above, loudly. Photos then show the plain panel instead of crashing.
      config = null;
    }
    return (imagePath: string) => (config && accessToken ? postImageSource(config, imagePath, accessToken) : null);
  }, [accessToken]);

  const [state, setState] = useState<FeedState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // Whose posts the current feed was loaded for, so later pages ask for the same people.
  const authors = useRef<string[]>([]);
  // Each load gets a number; an answer that arrives after a newer load started is ignored.
  const generation = useRef(0);
  // True while a next-page request is out (see loadMore).
  const pageInFlight = useRef(false);

  // B24: the remembered order and flair, tagged with whose they are (an account switch never
  // shows the previous lifter's choice). Taken from memory at once when this app session has
  // already read them; otherwise read from the phone before the first feed request.
  const [stored, setStored] = useState<{ userId: string; prefs: FeedPrefs } | null>(() => {
    const cached = me ? getCachedFeedPrefs(me) : null;
    return me && cached ? { userId: me, prefs: cached } : null;
  });
  const prefs = stored && stored.userId === me ? stored.prefs : null;
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    void loadFeedPrefs(me).then((loaded) => {
      if (!cancelled) setStored({ userId: me, prefs: loaded });
    });
    return () => {
      cancelled = true;
    };
  }, [me]);

  // B24: the flair chips, from the phone's copy of the flair list (names are data, never code).
  // Re-read whenever Home comes into view, so a sync that changed the list shows up. If the
  // database can't open, the row is just "All" and the feed still works.
  const { db, error: dbError } = useAppDatabase();
  const [flairs, setFlairs] = useState<FlairRow[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (dbError) {
        setFlairs([]);
        return;
      }
      if (!db) return;
      let cancelled = false;
      readFlairs(db)
        .then((rows) => {
          if (!cancelled) setFlairs(rows);
        })
        .catch((caught: unknown) => {
          console.warn('Home: could not read the flair list', caught);
          if (!cancelled) setFlairs([]);
        });
      return () => {
        cancelled = true;
      };
    }, [db, dbError]),
  );

  // The flair actually filtered on: the remembered one only if the phone's list still has it.
  // A stale id (a retired flair, or the list not downloaded yet) reads as "All" — the feed is
  // never filtered by a chip the lifter can't see. The stored id is left alone (plan, G6).
  const flairById = (id: string | null): FlairRow | null => (id ? (flairs?.find((f) => f.id === id) ?? null) : null);
  const activeFlair = flairById(prefs?.flairId ?? null);
  const sort: FeedSort = prefs?.sort ?? 'latest';
  const flairId = activeFlair?.id ?? null;
  // The first request waits for both, so launch reads once, already in the remembered order.
  const settingsReady = prefs !== null && flairs !== null;

  /** Loads the first page from scratch: who I follow, then their posts in the chosen order and flair. */
  const refresh = useCallback(async () => {
    if (!me || !settingsReady) return;
    const mine = ++generation.current;
    try {
      const ids = await feedAuthorIds(client, me);
      const page = await loadFeedPage(client, me, ids, sort, flairId, null);
      if (mine !== generation.current) return;
      authors.current = ids;
      setMoreFailed(false);
      setState({ status: 'ready', posts: page.posts, next: page.next, followsSomeone: ids.length > 1, sort, flairId });
    } catch (error: unknown) {
      if (mine !== generation.current) return;
      console.warn('Home: the feed could not be loaded', error);
      // Keep what's already on screen if a background refresh of the same feed fails; only an
      // empty Home — or a list in an order / flair the lifter has since switched away from — shows the error.
      setState((prev) =>
        prev.status === 'ready' && prev.sort === sort && prev.flairId === flairId ? prev : { status: 'error' },
      );
    }
  }, [client, me, settingsReady, sort, flairId]);

  /**
   * A chip was tapped (B24): remember the new order or flair, in memory and on the phone for next
   * launch. The reload follows by itself: `refresh` depends on the order and flair, so a change
   * makes the focus effect run it again (and its new `generation` drops any older answer).
   */
  function choose(next: FeedPrefs): void {
    if (!me) return;
    saveFeedPrefs(me, next);
    setStored({ userId: me, prefs: next });
  }

  // Fresh every time Home comes into view (first open, back from Find lifters, tab switch).
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  /** Pull-to-refresh: the same first-page load, with the spinner showing. */
  async function pullToRefresh(): Promise<void> {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  /**
   * Scrolled to the bottom: fetch the next page after the last post shown, if there is one.
   * A ref (not the `loadingMore` state, which only updates on the next draw) makes sure two
   * quick "reached the end" signals send one request. An answer that lands after a refresh
   * started is dropped — success or failure — so it can't touch the fresh feed.
   */
  async function loadMore(): Promise<void> {
    if (!me || state.status !== 'ready' || state.next == null || pageInFlight.current) return;
    const mine = generation.current;
    pageInFlight.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      // The list's own order and flair, so the bookmark always continues the list it came from.
      const page = await loadFeedPage(client, me, authors.current, state.sort, state.flairId, state.next);
      if (mine === generation.current) {
        setState((prev) =>
          prev.status === 'ready' ? { ...prev, posts: appendPage(prev.posts, page.posts), next: page.next } : prev,
        );
      }
    } catch (error: unknown) {
      console.warn('Home: the next page could not be loaded', error);
      if (mine === generation.current) setMoreFailed(true);
    } finally {
      pageInFlight.current = false;
      setLoadingMore(false);
    }
  }

  /** A card's vote (B23): +1 / −1 is cast, null takes the viewer's vote back. */
  const vote = useCallback(
    (postId: string, value: VoteValue | null): Promise<VoteResult> => {
      if (!me) return Promise.resolve({ ok: false, reason: 'failed' });
      return value === null ? clearVote(client, me, postId) : castVote(client, me, postId, value);
    },
    [client, me],
  );

  /** A card's comments button (B23): the post's comments screen. */
  const openComments = useCallback(
    (postId: string) => router.push({ pathname: '/post-comments/[id]', params: { id: postId } }),
    [router],
  );

  const header = (
    <View style={styles.header}>
      <Heading size="display">Astra</Heading>
      <View style={styles.headerRow}>
        <SectionLabel>Your feed</SectionLabel>
        <View style={styles.headerActions}>
          <Button label="Share a photo" variant="ghost" onPress={() => router.push('/new-post')} />
          <Button label="Find lifters" variant="ghost" onPress={() => router.push('/find-lifters')} />
        </View>
      </View>
      {/* Shown once both the remembered choice and the flair list are read, so a chip is never lit wrongly. */}
      {prefs && settingsReady ? (
        <View style={styles.controls}>
          <ChoiceChips
            options={SORT_OPTIONS}
            selected={sort}
            onSelect={(value) => choose({ ...prefs, sort: value })}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.flairRow}>
            <ChoiceChips
              options={[
                { value: ALL_FLAIRS, label: 'All', spoken: 'Show posts of every flair' },
                ...(flairs ?? []).map((f) => ({ value: f.id, label: f.name, spoken: `Show only ${f.name} posts` })),
              ]}
              selected={flairId ?? ALL_FLAIRS}
              onSelect={(value) => choose({ ...prefs, flairId: value === ALL_FLAIRS ? null : value })}
            />
          </ScrollView>
        </View>
      ) : null}
    </View>
  );

  // A list loaded in an order or flair other than the one now chosen (a chip was just tapped, or
  // the remembered flair turned up in a fresh flair list) is not shown: "Loading" until the
  // matching list arrives, so a list never sits under the wrong chip.
  const showsChoice = state.status === 'ready' && state.sort === sort && state.flairId === flairId;
  if (state.status !== 'ready' || !showsChoice) {
    return (
      <Screen>
        {header}
        {state.status === 'error' ? (
          <EmptyState
            icon="cloud-offline-outline"
            message="The feed needs a connection. Logging workouts and the Tool Kit still work offline."
            actionLabel="Retry"
            onAction={() => {
              setState({ status: 'loading' });
              void refresh();
            }}
          />
        ) : (
          <Body variant="muted">Loading your feed…</Body>
        )}
      </Screen>
    );
  }

  // A feed filtered to a flair with nothing in it says so — it is not a friendless feed (B24).
  const filteredFlair = flairById(state.flairId);
  const empty = filteredFlair ? (
    <EmptyState
      icon="pricetag-outline"
      message={`No ${filteredFlair.name} posts yet.`}
      actionLabel="Show all posts"
      onAction={() => {
        if (prefs) choose({ ...prefs, flairId: null });
      }}
    />
  ) : state.followsSomeone ? (
    <EmptyState
      icon="people-outline"
      message="Nobody you follow has posted yet. Find more lifters, or log your own session."
      actionLabel="Find lifters"
      onAction={() => router.push('/find-lifters')}
    />
  ) : (
    <View>
      <EmptyState
        icon="people-outline"
        message="Workouts, PRs and progress from lifters you follow will show up here. Find people to follow, or start by logging your own session."
        actionLabel="Find lifters"
        onAction={() => router.push('/find-lifters')}
      />
      <Button label="Log a workout" variant="ghost" onPress={() => router.push('/workout')} />
    </View>
  );

  const footer = moreFailed ? (
    <View style={styles.footer}>
      <Body variant="small">Couldn’t load more posts.</Body>
      <Button label="Try again" variant="ghost" onPress={() => void loadMore()} />
    </View>
  ) : loadingMore ? (
    <Body variant="small" style={styles.footer}>
      Loading more…
    </Body>
  ) : undefined;

  return (
    <Screen scroll={false}>
      <FlatList
        testID="home-feed"
        data={state.posts}
        keyExtractor={(post) => post.id}
        renderItem={({ item }) => (
          <PostCard post={item} viewerId={me} photoSource={photoSource} onVote={vote} onOpenComments={openComments} />
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
  headerRow: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flexShrink: 1,
    gap: spacing.xs,
  },
  controls: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  flairRow: {
    paddingRight: spacing.md,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
});
