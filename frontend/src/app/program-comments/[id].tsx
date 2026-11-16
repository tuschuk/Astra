/**
 * Program comments — one Marketplace program's conversation (B41 — MKT-3). Reached from the
 * comments button on a published program's page ("3 comments" / "Comment").
 *
 * What it shows: the program's comments oldest first, each with who wrote it, when and what they
 * said; a line if there are more than one load brings back (200); then a box to write a comment.
 * Exactly the post Comments screen's list and composer (`CommentsPane`), so the rules are the same:
 * up to 500 characters, a counter near the limit, Send off while blank, too long or sending.
 *
 * What the user can do: read everyone's comments, add their own (it appears as the server saved
 * it), and go Back. There is no ⋯ report button here yet — reporting program comments is a
 * recorded follow-up (docs/DEFERRED.md).
 *
 * Comments live on the server, so with no connection the screen says so and offers Retry. The
 * server decides who may read (whoever may see the program) and write (anyone signed in, on a
 * published program, as themselves).
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { CommentsPane } from '@/components/social/CommentsPane';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Text';
import { getSupabase } from '@/lib/supabase';
import { addProgramComment, loadProgramComments } from '@/social/comments';
import { spacing } from '@/theme';

export default function ProgramCommentsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const programId = typeof id === 'string' ? id : '';
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);

  // Stable per program, so the pane reads once on open (and again only on Retry).
  const load = useCallback(() => loadProgramComments(client, programId), [client, programId]);
  const send = useCallback(
    (body: string) => {
      if (!me) return Promise.reject(new Error('Not signed in'));
      return addProgramComment(client, me, programId, body);
    },
    [client, me, programId],
  );

  /** Back to the program page, or to the Marketplace if there is nothing to go back to. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/marketplace');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Comments</Heading>
      <CommentsPane load={load} send={send} me={me} placeholder="Say something about this program" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
});
