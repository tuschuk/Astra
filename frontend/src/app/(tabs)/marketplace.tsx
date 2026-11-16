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
 * Featured programs, votes and comments come later (B41).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase } from '@/lib/supabase';
import { loadPublishedPrograms, MARKETPLACE_PAGE_SIZE, type MarketplaceProgram } from '@/social/marketplace';
import { personLabels } from '@/social/names';
import { colors, radii, spacing, type } from '@/theme';

/** How long typing must pause before a search runs, in milliseconds (the Find lifters pace). */
export const MARKETPLACE_SEARCH_DEBOUNCE_MS = 300;

/** Shown when the Marketplace can't be read. */
export const MARKETPLACE_OFFLINE =
  'The Marketplace needs a connection. Logging workouts and your own programs still work offline.';

/** Shown when nothing is published at all. */
export const MARKETPLACE_EMPTY = 'Nothing published yet. Publish one of your programs from its page to list it here.';

/** One program as a tappable card: its name, and who wrote it. */
function ProgramCard({ program, onOpen }: { program: MarketplaceProgram; onOpen: () => void }) {
  const author = personLabels(program.author);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open program ${program.name}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Body style={styles.programName}>{program.name}</Body>
      <Body variant="small">by {author.name}</Body>
    </Pressable>
  );
}

export default function MarketplaceScreen() {
  const router = useRouter();
  const client = useMemo(() => getSupabase(), []);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(MARKETPLACE_PAGE_SIZE);
  const [attempt, setAttempt] = useState(0);
  // The latest server answer and what it answers (`results` null = the read failed).
  const [answer, setAnswer] = useState<{ query: string; limit: number; attempt: number; results: MarketplaceProgram[] | null } | null>(null);

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
  const searching = query.trim() !== '';

  let content: React.ReactNode;
  if (fresh && fresh.results == null) {
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
        Programs published by the community. Save one and start it in one tap — voting on
        programs comes later.
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
