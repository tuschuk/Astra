/**
 * Find lifters — reached from the "Find lifters" button on Home.
 *
 * What it shows: a search box, and below it the lifters whose username or display name
 * contains what was typed (two letters or more), each as a user card with a Follow /
 * Following button. You never appear in your own results, nor does anyone you've blocked.
 *
 * What the user can do: type to search (results update a moment after typing stops), and
 * follow or unfollow anyone in the results (SOC-7: one-way, no approval), and tap a card to open
 * that lifter's profile (B25). Back returns to
 * Home, which reloads so a newly followed lifter's posts show up.
 *
 * Searching needs a connection — people are looked up on the server; with no signal the
 * screen says so.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { UserCard } from '@/components/social/UserCard';
import { Button } from '@/components/ui/Button';
import { Body, Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase } from '@/lib/supabase';
import { follow, MIN_SEARCH_LENGTH, searchLifters, unfollow, type LifterResult } from '@/social/follows';
import { spacing } from '@/theme';

/** How long typing must pause before the search runs, in milliseconds. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Where the search stands: nothing typed yet, waiting on the server, results, or failed. */
type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; results: LifterResult[] }
  | { status: 'error' };

export default function FindLiftersScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);
  const [query, setQuery] = useState('');
  // The latest server answer and the text it answers (`results` null = the search failed).
  const [answer, setAnswer] = useState<{ query: string; results: LifterResult[] | null } | null>(null);
  const tooShort = query.trim().length < MIN_SEARCH_LENGTH;

  // Run the search once typing pauses; a newer search makes an older answer irrelevant.
  useEffect(() => {
    if (!me || tooShort) return;
    let current = true;
    const timer = setTimeout(() => {
      searchLifters(client, me, query)
        .then((results) => {
          if (current) setAnswer({ query, results });
        })
        .catch((error: unknown) => {
          console.warn('Find lifters: search failed', error);
          if (current) setAnswer({ query, results: null });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, me, query, tooShort]);

  // What to show follows from the text and the answer: an answer for older text means "still searching".
  const search: SearchState = tooShort
    ? { status: 'idle' }
    : answer?.query !== query
      ? { status: 'searching' }
      : answer.results == null
        ? { status: 'error' }
        : { status: 'done', results: answer.results };

  /** Back to Home, or to the Home tab if there is nothing to go back to. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Find lifters</Heading>
      <TextField
        label="Search lifters"
        placeholder="Name or username"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />

      {search.status === 'idle' ? (
        <Body variant="muted">Type at least {MIN_SEARCH_LENGTH} letters of a name or username.</Body>
      ) : null}
      {search.status === 'searching' ? <Body variant="muted">Searching…</Body> : null}
      {search.status === 'error' ? (
        <Body variant="muted">Searching needs a connection. Check your signal and try again.</Body>
      ) : null}
      {search.status === 'done' && search.results.length === 0 ? (
        <Body variant="muted">No lifters match “{query.trim()}”.</Body>
      ) : null}
      {search.status === 'done' && me
        ? search.results.map((lifter) => (
            <UserCard
              key={lifter.id}
              lifter={lifter}
              onSetFollowing={(next) => (next ? follow(client, me, lifter.id) : unfollow(client, me, lifter.id))}
              onOpenProfile={() => router.push({ pathname: '/profile/[id]', params: { id: lifter.id } })}
            />
          ))
        : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  search: {
    marginVertical: spacing.lg,
  },
});
