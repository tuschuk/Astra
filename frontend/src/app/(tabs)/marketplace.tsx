/**
 * Marketplace tab — browse and search the programs lifters have published (B40 — MKT-1).
 *
 * What it shows: a search box, then every published program, newest first, as cards — the
 * program's name and its author's name. Past the first 30, a "Show more" button reads 30 more.
 * Typing in the box narrows the list to programs whose name contains every typed word (whole
 * words, any order — "strength" finds "Starting Strength"); clearing it brings the full list back.
 *
 * What the user can do: search, scroll, Show more, and tap a card to open the program's page
 * (`/marketplace-program/[id]`) — its author, length, days per week, every workout, and Save and
 * Start.
 *
 * The Marketplace lives on the server, so it needs a connection: with no signal (or a failed
 * read) it says so with Retry, like the feed. Programs saved from it are on the phone afterwards.
 *
 * (B41 — MKT-2) Above the full list, while the search box is blank: a **Featured** section — the
 * ten most popular published programs over the chosen window, picked with four chips (Week ·
 * Month · Year · All time; Week first). "Most popular" is net votes (ups minus downs) cast in the
 * last 7 / 30 / 365 days, or ever; ties, including a quiet week where nobody voted, go to the
 * newest program. Each featured card shows its score ("by Alex · ▲ 12") and opens the program's
 * page, where the voting happens. Coming back to the tab reads both lists again, so a vote just
 * cast shows in the ranking. If either list can't be read, the tab shows its one offline message.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase } from '@/lib/supabase';
import {
  loadFeaturedPrograms,
  loadPublishedPrograms,
  MARKETPLACE_PAGE_SIZE,
  type FeaturedProgram,
  type FeaturedWindow,
  type MarketplaceProgram,
} from '@/social/marketplace';
import { personLabels } from '@/social/names';
import { colors, radii, spacing, type } from '@/theme';

/** How long typing must pause before a search runs, in milliseconds (the Find lifters pace). */
export const MARKETPLACE_SEARCH_DEBOUNCE_MS = 300;

/** Shown when the Marketplace can't be read. */
export const MARKETPLACE_OFFLINE =
  'The Marketplace needs a connection. Logging workouts and your own programs still work offline.';

/** Shown when nothing is published at all. */
export const MARKETPLACE_EMPTY = 'Nothing published yet. Publish one of your programs from its page to list it here.';

/** (B41) The Featured section's heading. */
export const FEATURED_HEADING = 'Featured';

/** (B41) The window chips, in order: rolling last 7 / 30 / 365 days, and every vote ever. */
const FEATURED_OPTIONS: readonly ChoiceOption<FeaturedWindow>[] = [
  { value: 'week', label: 'Week', spoken: 'Most popular this week' },
  { value: 'month', label: 'Month', spoken: 'Most popular this month' },
  { value: 'year', label: 'Year', spoken: 'Most popular this year' },
  { value: 'all', label: 'All time', spoken: 'Most popular of all time' },
];

/**
 * One program as a tappable card: its name, and who wrote it. A Featured card (B41, `score`
 * given) adds its net score in the chosen window to the author line ("by Alex · ▲ 12") and has
 * its own label, so the two lists stay distinguishable to a screen reader.
 */
function ProgramCard({ program, onOpen, score }: { program: MarketplaceProgram; onOpen: () => void; score?: number }) {
  const author = personLabels(program.author);
  const featured = score != null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={featured ? `Open featured program ${program.name}, score ${score}` : `Open program ${program.name}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Body style={styles.programName}>{program.name}</Body>
      <Body variant="small">{featured ? `by ${author.name} · ${scoreLabel(score)}` : `by ${author.name}`}</Body>
    </Pressable>
  );
}

/** A net score as a Featured card shows it: "▲ 12", "▼ 2" below zero, "▲ 0" with no votes. */
export function scoreLabel(score: number): string {
  return score < 0 ? `▼ ${Math.abs(score)}` : `▲ ${score}`;
}

export default function MarketplaceScreen() {
  const router = useRouter();
  const client = useMemo(() => getSupabase(), []);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(MARKETPLACE_PAGE_SIZE);
  const [attempt, setAttempt] = useState(0);
  // The latest server answer and what it answers (`results` null = the read failed).
  const [answer, setAnswer] = useState<{ query: string; limit: number; attempt: number; results: MarketplaceProgram[] | null } | null>(null);
  // (B41) The Featured section: the chosen window and the latest answer for it.
  const [featuredWindow, setFeaturedWindow] = useState<FeaturedWindow>('week');
  const [featured, setFeatured] = useState<{ window: FeaturedWindow; attempt: number; results: FeaturedProgram[] | null } | null>(null);
  const searching = query.trim() !== '';

  // (B41) Coming back to the tab (e.g. from a program page where the lifter voted) reads both
  // lists again, so the ranking reflects the votes as they now stand. The first focus is the
  // opening read itself, so it is skipped.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setAttempt((n) => n + 1);
    }, []),
  );

  // (B41) Read the window's top programs — only while the search box is blank (a lifter typing a
  // name is past browsing, and a ranked shelf beside search results would muddle their order).
  useEffect(() => {
    if (searching) return;
    let current = true;
    loadFeaturedPrograms(client, featuredWindow)
      .then((results) => {
        if (current) setFeatured({ window: featuredWindow, attempt, results });
      })
      .catch((error: unknown) => {
        console.warn('Marketplace: the featured programs could not be read', error);
        if (current) setFeatured({ window: featuredWindow, attempt, results: null });
      });
    return () => {
      current = false;
    };
  }, [client, featuredWindow, attempt, searching]);

  // Read once typing pauses (at once for the plain browse list); a newer read makes an older answer irrelevant.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(
      () => {
        loadPublishedPrograms(client, { query, limit })
          .then((results) => {
            if (current) setAnswer({ query, limit, attempt, results });
          })
          .catch((error: unknown) => {
            console.warn('Marketplace: the list could not be read', error);
            if (current) setAnswer({ query, limit, attempt, results: null });
          });
      },
      query.trim() === '' ? 0 : MARKETPLACE_SEARCH_DEBOUNCE_MS,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, query, limit, attempt]);

  /** New text starts the list again from the first page. */
  function search(text: string): void {
    setQuery(text);
    setLimit(MARKETPLACE_PAGE_SIZE);
  }

  // An answer to older text (or an older page size) means a read is still on its way.
  const fresh = answer && answer.query === query && answer.limit === limit && answer.attempt === attempt ? answer : null;
  // While "Show more" reads, keep the cards already shown rather than blanking the list.
  const shown = fresh?.results ?? (answer?.query === query ? answer.results : null);
  // (B41) The Featured answer for the chosen window; a failed read of the freshest attempt
  // shares the tab's one offline message with the browse list.
  const featuredShown = featured?.window === featuredWindow ? featured.results : null;
  const featuredFailed = !searching && featured?.window === featuredWindow && featured.attempt === attempt && featured.results == null;

  let content: React.ReactNode;
  if ((fresh && fresh.results == null) || featuredFailed) {
    content = (
      <EmptyState icon="cloud-offline-outline" message={MARKETPLACE_OFFLINE} actionLabel="Retry" onAction={() => setAttempt((n) => n + 1)} />
    );
  } else if (!shown) {
    content = <Body variant="muted">{searching ? 'Searching…' : 'Loading programs…'}</Body>;
  } else if (shown.length === 0) {
    content = searching ? (
      <Body variant="muted">No programs match “{query.trim()}”.</Body>
    ) : (
      <EmptyState icon="storefront-outline" message={MARKETPLACE_EMPTY} />
    );
  } else {
    content = (
      <View style={styles.list}>
        {shown.map((program) => (
          <ProgramCard
            key={program.id}
            program={program}
            onOpen={() => router.push({ pathname: '/marketplace-program/[id]', params: { id: program.id } })}
          />
        ))}
        {fresh && shown.length >= limit ? (
          <Button label="Show more" variant="ghost" onPress={() => setLimit((n) => n + MARKETPLACE_PAGE_SIZE)} />
        ) : null}
      </View>
    );
  }

  return (
    <Screen>
      <Heading>Marketplace</Heading>
      <Body variant="muted" style={styles.lede}>
        Programs published by the community. Save one and start it in one tap, and vote for the
        ones that work.
      </Body>
      <TextField
        label="Search programs"
        placeholder="Program name"
        value={query}
        onChangeText={search}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />
      {/* Featured shows with a blank search box and something on the shelf (an empty shelf has
          only the browse list's own empty message). */}
      {!searching && !featuredFailed && !(fresh && fresh.results == null) && featuredShown?.length !== 0 ? (
        <View style={styles.featured}>
          <Heading size="section">{FEATURED_HEADING}</Heading>
          <ChoiceChips options={FEATURED_OPTIONS} selected={featuredWindow} onSelect={setFeaturedWindow} fill />
          {featuredShown == null ? (
            <Body variant="muted">Loading featured programs…</Body>
          ) : (
            <View style={styles.list}>
              {featuredShown.map((program) => (
                <ProgramCard
                  key={program.id}
                  program={program}
                  score={program.score}
                  onOpen={() => router.push({ pathname: '/marketplace-program/[id]', params: { id: program.id } })}
                />
              ))}
            </View>
          )}
          <SectionLabel size="small">All programs</SectionLabel>
        </View>
      ) : null}
      {content}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: {
    marginTop: spacing.sm,
  },
  search: {
    marginVertical: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  featured: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  card: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.accentDim,
  },
  programName: {
    ...type.cardTitle,
  },
});
