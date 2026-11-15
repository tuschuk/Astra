/**
 * Home — the social feed (SOC-1).
 *
 * What it shows: posts from the lifters you follow, and your own, newest first, as post cards
 * (components/social/PostCard) — shared workouts, and (B22) progress-pic and PR photos, each
 * photo fetched with the viewer's sign-in so the server decides who sees it. Twenty at a time;
 * scrolling to the bottom loads the next twenty, and pulling down refreshes. The feed also
 * refreshes each time Home comes back into view (after following someone on Find lifters, their
 * posts are there; after Share a photo, yours is, once it has uploaded).
 *
 * What the user can do: read the feed, pull to refresh, open Share a photo (B22) to post a
 * progress pic or PR photo, and open Find lifters to search for people and follow them.
 *
 * When there is nothing to show:
 *   - following nobody and no posts of your own → an invitation to find lifters, plus the
 *     existing "log a workout" action;
 *   - following people who haven't posted → the same invitation, worded for that;
 *   - no connection (or the request failed) → "The feed needs a connection" with Retry. The feed
 *     is read from the server (other people's workouts are never stored on the phone), so it is
 *     the one screen that needs signal; logging and the Tool Kit keep working offline.
 *
 * Who can see which post is decided by the server's security rules, never here.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { PostCard } from '@/components/social/PostCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { getSupabase, readSupabaseConfig, type SupabaseConfig } from '@/lib/supabase';
import { appendPage, feedAuthorIds, loadFeedPage, type FeedCursor, type FeedPost } from '@/social/feed';
import { postImageSource } from '@/social/postImages';
import { colors, spacing } from '@/theme';

/** What Home is showing: the first load, a failed load, or the feed itself. */
type FeedState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; posts: FeedPost[]; next: FeedCursor | null; followsSomeone: boolean };

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

  /** Loads the first page from scratch: who I follow, then their newest posts. */
  const refresh = useCallback(async () => {
    if (!me) return;
    const mine = ++generation.current;
    try {
      const ids = await feedAuthorIds(client, me);
      const page = await loadFeedPage(client, ids, null);
      if (mine !== generation.current) return;
      authors.current = ids;
      setMoreFailed(false);
      setState({ status: 'ready', posts: page.posts, next: page.next, followsSomeone: ids.length > 1 });
    } catch (error: unknown) {
      if (mine !== generation.current) return;
      console.warn('Home: the feed could not be loaded', error);
      // Keep what's already on screen if a background refresh fails; only an empty Home shows the error.
      setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [client, me]);

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
    if (state.status !== 'ready' || state.next == null || pageInFlight.current) return;
    const mine = generation.current;
    pageInFlight.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await loadFeedPage(client, authors.current, state.next);
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
    </View>
  );

  if (state.status !== 'ready') {
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

  const empty = state.followsSomeone ? (
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
        renderItem={({ item }) => <PostCard post={item} viewerId={me} photoSource={photoSource} />}
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
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
});
