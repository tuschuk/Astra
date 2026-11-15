/**
 * ProfileView — a lifter's whole profile (YOU-1, YOU-2, YOU-3, SOC-7; B25). The You tab shows it
 * for the signed-in lifter; `profile/[id]` shows it for anyone (opened from a post card's author or
 * a Find lifters card — opening your own id there shows your own profile).
 *
 * What it shows, top to bottom:
 *   - the header's five facts: the profile photo (or letter avatar), the display name (with the
 *     @username under it), the bio, and the Followers and Following counts. The counts come from
 *     the server's `follow_counts` (every follow row — the app itself may only see its own), so
 *     they equal the real number of follows;
 *   - on your own profile, **Edit profile**; on someone else's, **Follow / Following** — after a
 *     follow or unfollow the counts are read again, so the number always matches the button;
 *   - (B36, YOU-6) a **Teams** section — the lifter's teams as rows ("Open" / "Invite only", and
 *     on your own profile your role), each opening that team's page. The server decides which of
 *     someone else's teams you see: their open teams, and invite-only teams you share. No teams
 *     to show → no section;
 *   - three tabs: **Posts** (their posts as feed cards, newest first, twenty at a time — the server
 *     decides which ones the viewer may see), **History** (every finished workout, newest first,
 *     paging back to the very first one), and **PRs** (current records per exercise, e.g.
 *     "1RM 140 kg · e1RM 151.7 kg · 5RM 130 kg", in the viewer's kg / lb unit). On your own
 *     Posts tab (B26) each card has the "who can see this" chip — Only you / Followers / Public.
 *   - (B27) on someone else's profile, **Mute / Unmute** and **Block / Unblock** under the follow
 *     button. Mute hides their posts, workouts and comments from you, one way, without telling
 *     them and without unfollowing. Block (asked first) hides both ways and removes follows both
 *     ways; while blocking, there is no Follow button. A muted or blocked profile says so in one
 *     line — its tabs are empty because the server leaves that lifter's content out. After any
 *     change the header, counts and open tab are read again. Their post cards' ⋯ reports a post.
 *   - (B28) the Posts tab includes the lifter's re-shares (the original shown inside each). On
 *     someone else's cards, Re-share passes a post on to your own followers; on your own workout
 *     cards, Share opens the image share card for the phone's share sheet.
 *
 * Where the data comes from:
 *   - your own History and PRs are read from the phone, so they work with no signal, and a past
 *     workout opens its saved-workout screen when tapped;
 *   - everything about another lifter is read from the server as you (never stored on the phone);
 *     tapping one of their workouts (B37) opens the whole session, read online (`/session/[id]`).
 *     If you coach a team they're on, their History includes their private workouts too — the
 *     server's coach rule, never decided here;
 *   - your own name, bio and photo are also remembered on the phone (`ownProfileCache`), so the
 *     You tab shows who you are offline. Counts and posts need a connection; without one the
 *     counts show a dash and the screen says so, with Retry.
 *
 * A profile that doesn't exist (a deleted account, a bad link) says "This lifter isn't available".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/social/Avatar';
import { FollowButton } from '@/components/social/FollowButton';
import { PostCard, UNNAMED_EXERCISE } from '@/components/social/PostCard';
import { usePostListActions } from '@/components/social/usePostListActions';
import { usePostPhotoSource } from '@/components/social/usePostPhotoSource';
import { TeamListItem } from '@/components/teams/TeamListItem';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { WorkoutListItem } from '@/components/workout/WorkoutListItem';
import type { WorkoutVisibility } from '@/db/dao';
import { useAppDatabase } from '@/db/useAppDatabase';
import { getSupabase } from '@/lib/supabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { appendPage, loadFeedPage, type FeedCursor, type FeedPost } from '@/social/feed';
import { follow, unfollow } from '@/social/follows';
import {
  blockUser,
  muteUser,
  relationTo,
  unblockUser,
  unmuteUser,
  type Relation,
  type SafetyResult,
} from '@/social/moderation';
import { personLabels } from '@/social/names';
import { getCachedOwnProfile, loadOwnProfile, saveOwnProfile, type OwnProfileIdentity } from '@/social/ownProfileCache';
import { withPostVisibility } from '@/social/postPrivacy';
import {
  loadProfileHeader,
  loadProfilePrs,
  loadWorkoutHistory,
  type ExercisePrs,
  type HistoryCursor,
  type ProfileHeader,
  type ProfileWorkout,
} from '@/social/profile';
import { loadTeamsOf, type TeamMembership } from '@/social/teams';
import { formatPrLine, workoutDateLabel, workoutDetailsLabel } from '@/workout/format';
import { listPastWorkouts, type PastWorkoutSummary } from '@/workout/history';
import { allCurrentPrs } from '@/workout/prs';
import { colors, radii, spacing, type } from '@/theme';

/** The three tabs under the header. */
export type ProfileSection = 'posts' | 'history' | 'prs';

const SECTION_OPTIONS: readonly ChoiceOption<ProfileSection>[] = [
  { value: 'posts', label: 'Posts', spoken: 'Show posts' },
  { value: 'history', label: 'History', spoken: 'Show workout history' },
  { value: 'prs', label: 'PRs', spoken: 'Show personal records' },
];

/** How many of your own past workouts one page of History reads from the phone. */
export const OWN_HISTORY_PAGE_SIZE = 20;

/** The line a profile that doesn't exist shows. */
export const PROFILE_MISSING = 'This lifter isn’t available.';

/** The line under the header when the server can't be reached. */
export const PROFILE_OFFLINE = 'Counts and posts need a connection.';

/** (B27) The line on a profile you muted — their tabs are empty because of it, and this says why. */
export const PROFILE_MUTED_LINE = 'You muted this lifter. Their posts, workouts and comments are hidden from you. They aren’t told.';

/** (B27) The line on a profile you blocked. */
export const PROFILE_BLOCKED_LINE = 'You blocked this lifter. Neither of you can see the other’s posts, workouts or comments.';

/**
 * (B27) Asks before blocking — a block also removes follows both ways, which unblocking doesn't
 * bring back. "Cancel" does nothing; "Block" runs `onConfirm`. Uses the phone's native alert.
 */
export function confirmBlock(name: string, onConfirm: () => void): void {
  Alert.alert(
    `Block ${name}?`,
    'Neither of you will see the other’s posts, workouts or comments, and follows are removed both ways. They aren’t told.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: onConfirm },
    ],
  );
}

/** One History row: your own workout (from the phone, tappable) or someone else's (from the server). */
type HistoryRow = { kind: 'own'; summary: PastWorkoutSummary } | { kind: 'other'; workout: ProfileWorkout };


/** Where a paged list stands. */
type PagedList<T, C> =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; items: T[]; next: C | null; loadingMore: boolean; moreFailed: boolean };

/** Where the PR list stands. */
type PrList = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; groups: ExercisePrs[] };

/** Where the header stands. */
type HeaderState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'missing' }
  | { status: 'ready'; header: ProfileHeader };

/** One row of the list below the header, whatever the tab. */
type Item =
  | { key: string; kind: 'post'; post: FeedPost }
  | { key: string; kind: 'history'; row: HistoryRow }
  | { key: string; kind: 'prs'; group: ExercisePrs };

interface ProfileViewProps {
  /** Whose profile to show. */
  profileId: string;
  /** What sits at the very top: the You tab's Settings gear, the profile route's Back button. */
  topBar?: React.ReactNode;
}

export function ProfileView({ profileId, topBar }: ProfileViewProps) {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const own = me !== null && me === profileId;
  const client = useMemo(() => getSupabase(), []);
  const { db, error: dbError } = useAppDatabase();
  const unit = useDisplayUnit();
  const photoSource = usePostPhotoSource();

  const [headerState, setHeaderState] = useState<{ forId: string; state: HeaderState } | null>(null);
  const header: HeaderState = headerState?.forId === profileId ? headerState.state : { status: 'loading' };
  // Your own remembered name / bio / photo, shown until (or instead of, offline) the server's.
  const [cached, setCached] = useState<OwnProfileIdentity | null>(() => (own && me ? getCachedOwnProfile(me) : null));
  const [section, setSection] = useState<ProfileSection>('posts');
  const [posts, setPosts] = useState<PagedList<FeedPost, FeedCursor>>({ status: 'idle' });
  const [history, setHistory] = useState<PagedList<HistoryRow, HistoryCursor>>({ status: 'idle' });
  const [prs, setPrs] = useState<PrList>({ status: 'idle' });
  // (B27) Whether I block / mute this lifter, and a safety change in flight / its refusal.
  const [relationState, setRelation] = useState<{ forId: string; value: Relation } | null>(null);
  const relation = relationState?.forId === profileId ? relationState.value : null;
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);
  // (B36) The lifter's teams, tagged with whose they are.
  const [teamsState, setTeams] = useState<{ forId: string; value: TeamMembership[] } | null>(null);
  const teams = teamsState?.forId === profileId ? teamsState.value : [];
  // Each reload gets a number per list; an answer that lands after a newer reload is dropped.
  const generation = useRef({ header: 0, posts: 0, history: 0, prs: 0, relation: 0, teams: 0 });
  const pageInFlight = useRef(false);

  useEffect(() => {
    if (!own || !me) return;
    let cancelled = false;
    void loadOwnProfile(me).then((identity) => {
      if (!cancelled && identity) setCached(identity);
    });
    return () => {
      cancelled = true;
    };
  }, [own, me]);

  /** Reads the header (row, counts, whether I follow them). Keeps what's shown if a re-read fails. */
  const loadHeader = useCallback(async () => {
    if (!me) return;
    const mine = ++generation.current.header;
    try {
      const loaded = await loadProfileHeader(client, me, profileId);
      if (mine !== generation.current.header) return;
      setHeaderState({ forId: profileId, state: loaded ? { status: 'ready', header: loaded } : { status: 'missing' } });
      if (loaded && own) {
        // saveOwnProfile keeps only the identity fields.
        saveOwnProfile(me, loaded);
        setCached(getCachedOwnProfile(me));
      }
    } catch (error: unknown) {
      if (mine !== generation.current.header) return;
      console.warn('Profile: the header could not be loaded', error);
      setHeaderState((prev) =>
        prev?.forId === profileId && prev.state.status === 'ready' ? prev : { forId: profileId, state: { status: 'error' } },
      );
    }
  }, [client, me, profileId, own]);

  /**
   * (B27) Whether I block / mute this lifter — the Mute and Block buttons' states. Only read for
   * someone else's profile. A failed read leaves the buttons hidden (no guessing a state).
   */
  const loadRelation = useCallback(async () => {
    if (!me || own) return;
    const mine = ++generation.current.relation;
    try {
      const value = await relationTo(client, me, profileId);
      if (mine === generation.current.relation) setRelation({ forId: profileId, value });
    } catch (error: unknown) {
      if (mine !== generation.current.relation) return;
      console.warn('Profile: block / mute state could not be loaded', error);
    }
  }, [client, me, own, profileId]);

  /** The first page of posts: this lifter's own posts, newest first (the feed read, one author). */
  const loadPosts = useCallback(async () => {
    if (!me) return;
    const mine = ++generation.current.posts;
    setPosts((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    try {
      const page = await loadFeedPage(client, me, [profileId], 'latest', null, null);
      if (mine !== generation.current.posts) return;
      setPosts({ status: 'ready', items: page.posts, next: page.next, loadingMore: false, moreFailed: false });
    } catch (error: unknown) {
      if (mine !== generation.current.posts) return;
      console.warn('Profile: posts could not be loaded', error);
      setPosts((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [client, me, profileId]);

  /** One page of History after `after` (null = the first page), from the phone (own) or the server. */
  const historyPage = useCallback(
    async (after: HistoryCursor | null): Promise<{ rows: HistoryRow[]; next: HistoryCursor | null }> => {
      if (own) {
        if (!db || !me) throw new Error(dbError ? 'The phone’s workout storage couldn’t be opened' : 'Not ready');
        const page = await listPastWorkouts(db, me, OWN_HISTORY_PAGE_SIZE, after);
        const last = page[page.length - 1];
        return {
          rows: page.map((summary) => ({ kind: 'own' as const, summary })),
          next: page.length === OWN_HISTORY_PAGE_SIZE && last ? { started_at: last.workout.started_at, id: last.workout.id } : null,
        };
      }
      const page = await loadWorkoutHistory(client, profileId, after);
      return { rows: page.workouts.map((workout) => ({ kind: 'other' as const, workout })), next: page.next };
    },
    [own, db, me, dbError, client, profileId],
  );

  /** The first page of History. */
  const loadHistory = useCallback(async () => {
    if (own && !db && !dbError) return; // the phone's database is still opening; this reruns when it's ready
    const mine = ++generation.current.history;
    setHistory((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    try {
      const page = await historyPage(null);
      if (mine !== generation.current.history) return;
      setHistory({ status: 'ready', items: page.rows, next: page.next, loadingMore: false, moreFailed: false });
    } catch (error: unknown) {
      if (mine !== generation.current.history) return;
      console.warn('Profile: history could not be loaded', error);
      setHistory((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [own, db, dbError, historyPage]);

  /** The PR list: your own from the phone, someone else's from the server. */
  const loadPrs = useCallback(async () => {
    if (own && !db && !dbError) return;
    const mine = ++generation.current.prs;
    setPrs((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    try {
      let groups: ExercisePrs[];
      if (own) {
        if (!db || !me) throw new Error('The phone’s workout storage couldn’t be opened');
        groups = await allCurrentPrs(db, me);
      } else {
        groups = await loadProfilePrs(client, profileId);
      }
      if (mine !== generation.current.prs) return;
      setPrs({ status: 'ready', groups });
    } catch (error: unknown) {
      if (mine !== generation.current.prs) return;
      console.warn('Profile: PRs could not be loaded', error);
      setPrs((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [own, db, dbError, me, client, profileId]);

  /** (Re)loads the first page of one tab — the one the lifter is looking at. */
  const loadSection = useCallback(
    (which: ProfileSection) => (which === 'posts' ? loadPosts() : which === 'history' ? loadHistory() : loadPrs()),
    [loadPosts, loadHistory, loadPrs],
  );

  /**
   * (B36, YOU-6) The teams this lifter is in, for the Teams section. The server returns what the
   * viewer may see: all of your own; of someone else's, their open teams and invite-only teams
   * you share. A failed read just leaves the section away (the header shows the connection line).
   */
  const loadTeams = useCallback(async () => {
    if (!me) return;
    const mine = ++generation.current.teams;
    try {
      const memberships = await loadTeamsOf(client, profileId);
      if (mine === generation.current.teams) setTeams({ forId: profileId, value: memberships });
    } catch (error: unknown) {
      if (mine !== generation.current.teams) return;
      console.warn('Profile: teams could not be loaded', error);
    }
  }, [client, me, profileId]);

  // Fresh every time the profile comes into view (first open, back from Edit profile or a workout).
  useFocusEffect(
    useCallback(() => {
      void loadHeader();
      void loadRelation();
      void loadTeams();
    }, [loadHeader, loadRelation, loadTeams]),
  );
  useFocusEffect(
    useCallback(() => {
      void loadSection(section);
    }, [loadSection, section]),
  );

  /** Scrolled to the bottom of Posts or History: the next page, if there is one. */
  async function loadMore(): Promise<void> {
    if (pageInFlight.current || !me) return;
    if (section === 'posts' && posts.status === 'ready' && posts.next) {
      const mine = generation.current.posts;
      const after = posts.next;
      pageInFlight.current = true;
      setPosts((prev) => (prev.status === 'ready' ? { ...prev, loadingMore: true, moreFailed: false } : prev));
      try {
        const page = await loadFeedPage(client, me, [profileId], 'latest', null, after);
        if (mine === generation.current.posts) {
          setPosts((prev) =>
            prev.status === 'ready'
              ? { ...prev, items: appendPage(prev.items, page.posts), next: page.next, loadingMore: false }
              : prev,
          );
        }
      } catch (error: unknown) {
        console.warn('Profile: the next page of posts could not be loaded', error);
        if (mine === generation.current.posts) {
          setPosts((prev) => (prev.status === 'ready' ? { ...prev, loadingMore: false, moreFailed: true } : prev));
        }
      } finally {
        pageInFlight.current = false;
      }
      return;
    }
    if (section === 'history' && history.status === 'ready' && history.next) {
      const mine = generation.current.history;
      const after = history.next;
      pageInFlight.current = true;
      setHistory((prev) => (prev.status === 'ready' ? { ...prev, loadingMore: true, moreFailed: false } : prev));
      try {
        const page = await historyPage(after);
        if (mine === generation.current.history) {
          setHistory((prev) =>
            prev.status === 'ready'
              ? { ...prev, items: [...prev.items, ...page.rows], next: page.next, loadingMore: false }
              : prev,
          );
        }
      } catch (error: unknown) {
        console.warn('Profile: the next page of history could not be loaded', error);
        if (mine === generation.current.history) {
          setHistory((prev) => (prev.status === 'ready' ? { ...prev, loadingMore: false, moreFailed: true } : prev));
        }
      } finally {
        pageInFlight.current = false;
      }
    }
  }

  /**
   * Every post card button's wiring (B23–B28), shared with Home and the team feed
   * (`usePostListActions`). After an own card's privacy change the Posts tab's list is updated,
   * so a card rebuilt after scrolling shows the new audience.
   */
  const onVisibilityChanged = useCallback(
    (postId: string, next: WorkoutVisibility) =>
      setPosts((prev) => (prev.status === 'ready' ? { ...prev, items: withPostVisibility(prev.items, postId, next) } : prev)),
    [],
  );
  const actions = usePostListActions({ client, db, me, onVisibilityChanged });

  /**
   * (B27) Mute / unmute / block / unblock, then re-read everything — the server's security rules
   * change what the counts, tabs and follow button show, so the screen asks again rather than
   * guessing. One change at a time; a refusal shows a calm line under the buttons.
   */
  async function changeSafety(change: (c: typeof client, me: string, them: string) => Promise<SafetyResult>): Promise<void> {
    if (!me || safetyBusy) return;
    setSafetyBusy(true);
    setSafetyMessage(null);
    const result = await change(client, me, profileId);
    setSafetyBusy(false);
    if (!result.ok) {
      setSafetyMessage(result.message);
      return;
    }
    await Promise.all([loadRelation(), loadHeader(), loadSection(section)]);
  }

  if (header.status === 'missing') {
    return (
      <Screen>
        {topBar}
        <EmptyState icon="person-outline" message={PROFILE_MISSING} />
      </Screen>
    );
  }

  // Who to show: the server's header, or — on your own profile before it arrives or offline —
  // the remembered copy.
  const ready = header.status === 'ready' ? header.header : null;
  const identity: OwnProfileIdentity | null = ready ?? (own ? cached : null);
  const who = personLabels({ username: identity?.username ?? null, displayName: identity?.displayName ?? null });

  const headerBlock = (
    <View>
      {topBar}
      {identity || ready ? (
        <View style={styles.identityRow}>
          <Avatar path={identity?.avatarPath ?? null} initial={who.initial} size="large" />
          <View style={styles.identity}>
            <Heading size="section">{who.name}</Heading>
            {who.handle ? <Body variant="small">{who.handle}</Body> : null}
          </View>
        </View>
      ) : header.status === 'loading' ? (
        <Body variant="muted">Loading profile…</Body>
      ) : null}

      {identity ? (
        identity.bio ? (
          <Body style={styles.bio}>{identity.bio}</Body>
        ) : (
          <Body variant="muted" style={styles.bio}>
            {own ? 'Add a bio so lifters know what you train for.' : 'No bio yet.'}
          </Body>
        )
      ) : null}

      <View style={styles.counts}>
        <Count label="Followers" value={ready?.followers ?? null} />
        <Count label="Following" value={ready?.following ?? null} />
      </View>

      {own ? (
        <Button label="Edit profile" variant="ghost" onPress={() => router.push('/edit-profile')} style={styles.action} />
      ) : ready && me && !relation?.blocking ? (
        // No Follow while I block them — the server would refuse it anyway.
        <FollowButton
          // A re-read header remounts the button with the server's answer.
          key={`${ready.id}:${String(ready.viewerFollows)}`}
          initialFollowing={ready.viewerFollows === true}
          onSetFollowing={(next) => (next ? follow(client, me, profileId) : unfollow(client, me, profileId))}
          onSettled={() => void loadHeader()}
          style={styles.action}
        />
      ) : null}

      {!own && ready && me && relation ? (
        <View style={styles.safety}>
          {relation.blocking ? (
            <Body variant="small" style={styles.muted}>
              {PROFILE_BLOCKED_LINE}
            </Body>
          ) : relation.muting ? (
            <Body variant="small" style={styles.muted}>
              {PROFILE_MUTED_LINE}
            </Body>
          ) : null}
          <View style={styles.safetyButtons}>
            {relation.blocking ? null : (
              <Button
                label={relation.muting ? 'Unmute' : 'Mute'}
                variant="ghost"
                disabled={safetyBusy}
                onPress={() => void changeSafety(relation.muting ? unmuteUser : muteUser)}
                style={styles.safetyButton}
              />
            )}
            <Button
              label={relation.blocking ? 'Unblock' : 'Block'}
              variant="ghost"
              disabled={safetyBusy}
              onPress={() =>
                relation.blocking
                  ? void changeSafety(unblockUser)
                  : confirmBlock(who.name, () => void changeSafety(blockUser))
              }
              style={styles.safetyButton}
            />
          </View>
          {safetyMessage ? (
            <Body variant="small" style={styles.muted}>
              {safetyMessage}
            </Body>
          ) : null}
        </View>
      ) : null}

      {header.status === 'error' ? (
        <View style={styles.offline}>
          <Body variant="small">{PROFILE_OFFLINE}</Body>
          <Button
            label="Retry"
            variant="ghost"
            onPress={() => {
              void loadHeader();
              void loadSection(section);
            }}
          />
        </View>
      ) : null}

      {teams.length > 0 ? (
        <View style={styles.teams}>
          <SectionLabel>Teams</SectionLabel>
          {teams.map(({ team, role }) => (
            <TeamListItem
              key={team.id}
              team={team}
              role={own ? role : null}
              onPress={() => router.push({ pathname: '/team/[id]', params: { id: team.id } })}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.sections}>
        <ChoiceChips options={SECTION_OPTIONS} selected={section} onSelect={setSection} fill />
      </View>
    </View>
  );

  const items: Item[] =
    section === 'posts'
      ? posts.status === 'ready'
        ? posts.items.map((post) => ({ key: `post:${post.id}`, kind: 'post', post }))
        : []
      : section === 'history'
        ? history.status === 'ready'
          ? history.items.map((row) => ({
              key: `history:${row.kind === 'own' ? row.summary.workout.id : row.workout.id}`,
              kind: 'history',
              row,
            }))
          : []
        : prs.status === 'ready'
          ? prs.groups.map((group) => ({ key: `prs:${group.exerciseId}`, kind: 'prs', group }))
          : [];

  const current = section === 'posts' ? posts : section === 'history' ? history : prs;
  const empty =
    current.status === 'error' ? (
      <EmptyState
        icon="cloud-offline-outline"
        message={
          section === 'posts' || !own
            ? 'This needs a connection. Logging workouts and the Tool Kit still work offline.'
            : 'Your workouts couldn’t be read from this phone.'
        }
        actionLabel="Retry"
        onAction={() => void loadSection(section)}
      />
    ) : current.status !== 'ready' ? (
      <Body variant="muted">Loading…</Body>
    ) : section === 'posts' ? (
      <EmptyState icon="images-outline" message={own ? 'Your posts show up here.' : 'No posts yet.'} />
    ) : section === 'history' ? (
      <EmptyState icon="barbell-outline" message={own ? 'Finished workouts show up here.' : 'No workouts to show.'} />
    ) : (
      <EmptyState
        icon="trophy-outline"
        message={
          own
            ? 'PRs are caught automatically while you log — true 1RMs, rep maxes and estimated 1RMs, each listed here by exercise.'
            : 'No PRs to show.'
        }
      />
    );

  const paged = section === 'posts' ? posts : section === 'history' ? history : null;
  const footer =
    paged?.status === 'ready' && paged.moreFailed ? (
      <View style={styles.footer}>
        <Body variant="small">Couldn’t load more.</Body>
        <Button label="Try again" variant="ghost" onPress={() => void loadMore()} />
      </View>
    ) : paged?.status === 'ready' && paged.loadingMore ? (
      <Body variant="small" style={styles.footer}>
        Loading more…
      </Body>
    ) : undefined;

  /** One row of the list. */
  function renderItem({ item }: { item: Item }) {
    if (item.kind === 'post') {
      return (
        <PostCard
          post={item.post}
          viewerId={me}
          photoSource={photoSource}
          onVote={actions.vote}
          onChangeVisibility={actions.changeVisibility}
          onReport={actions.reportPost}
          onReshare={actions.reshare}
          onShareWorkout={actions.shareWorkout}
          onOpenComments={actions.openComments}
        />
      );
    }
    if (item.kind === 'history') {
      const { row } = item;
      return row.kind === 'own' ? (
        <WorkoutListItem
          summary={row.summary}
          onPress={() => router.push({ pathname: '/workout/[id]', params: { id: row.summary.workout.id } })}
        />
      ) : (
        <OtherWorkoutRow
          workout={row.workout}
          onPress={() => router.push({ pathname: '/session/[id]', params: { id: row.workout.id } })}
        />
      );
    }
    const line = formatPrLine(item.group.records, unit);
    return (
      <Card style={styles.prCard}>
        <Body style={styles.prName}>{item.group.exerciseName ?? UNNAMED_EXERCISE}</Body>
        <Body variant="small">{line}</Body>
      </Card>
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <FlatList
        testID="profile-list"
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={headerBlock}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

/** One count box: the number (a dash while unknown — offline, or still loading) over its label. */
function Count({ label, value }: { label: string; value: number | null }) {
  const shown = value === null ? '—' : String(value);
  return (
    <View style={styles.count} accessible accessibilityLabel={`${label}: ${value === null ? 'unknown' : shown}`}>
      <Body style={styles.countValue}>{shown}</Body>
      <SectionLabel size="small">{label}</SectionLabel>
    </View>
  );
}

/**
 * One of someone else's workouts in their History: its title (or date), "58 min · 3 exercises ·
 * 12 sets", and the exercises' names. Tapping it (B37) opens the whole session read from the
 * server (`/session/[id]`) — how a team's coach reads a member's training log.
 */
function OtherWorkoutRow({ workout, onPress }: { workout: ProfileWorkout; onPress: () => void }) {
  const title = workout.title ?? workoutDateLabel(workout.started_at);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.otherWorkout, pressed && styles.pressed]}
    >
      <Body style={styles.prName}>{title}</Body>
      <Body variant="small">{workoutDetailsLabel(workout, workout.exerciseNames.length, workout.setCount)}</Body>
      {workout.exerciseNames.length > 0 ? (
        <Body variant="small" style={styles.muted}>
          {workout.exerciseNames.map((name) => name ?? UNNAMED_EXERCISE).join(' · ')}
        </Body>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  identity: {
    flex: 1,
    gap: spacing.xs,
  },
  bio: {
    marginTop: spacing.md,
  },
  counts: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  count: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
  },
  countValue: {
    ...type.statValue,
  },
  action: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  offline: {
    marginTop: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  teams: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  sections: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  prCard: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  prName: {
    color: colors.text,
  },
  otherWorkout: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  muted: {
    color: colors.muted,
  },
  safety: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  safetyButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  safetyButton: {
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  screenContent: {
    paddingBottom: 0,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
});
