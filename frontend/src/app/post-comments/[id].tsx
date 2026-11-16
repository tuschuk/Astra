/**
 * Comments — one post's conversation (SOC-5, B23). Reached from the comments button on a feed
 * card ("3 comments" / "Comment").
 *
 * What it shows: the post's comments oldest first, each with who wrote it (a letter avatar,
 * display name, @username), when ("Today", "Yesterday" or the date) and what they said. If a
 * post has more comments than one load brings back (200), a line says so. Below the list, a box
 * to write a comment.
 *
 * What the user can do: read everyone's comments and add their own — up to 500 characters; a
 * counter appears near the limit, and Send stays off while the box is blank, too long, or a
 * comment is on its way. The new comment appears as the server saved it. Back returns to Home.
 * (B27) Each of other people's comments has a ⋯ that opens the report panel; reports go to the
 * founder's moderation queue. Comments by lifters the viewer blocked or muted never arrive — the
 * server leaves them out.
 *
 * Comments are read and written on the server (never stored on the phone), so with no
 * connection the screen says so and offers Retry. Who may see or comment on which post is the
 * server's security's call — exactly the people who can see the post.
 *
 * Since B41 the list and composer are `CommentsPane`, shared with a Marketplace program's
 * comments; this screen wires in the post's reads, writes and the report panel.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { CommentsPane } from '@/components/social/CommentsPane';
import { ReportSheet } from '@/components/social/ReportSheet';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Text';
import { getSupabase } from '@/lib/supabase';
import { addComment, loadComments } from '@/social/comments';
import { reportComment } from '@/social/moderation';
import { spacing } from '@/theme';

export { MORE_COMMENTS_LINE, SEND_FAILED_LINE } from '@/components/social/CommentsPane';

export default function PostCommentsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = typeof id === 'string' ? id : '';
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);
  // (B27) The comment whose report panel is open, if any.
  const [reportingId, setReportingId] = useState<string | null>(null);

  // Stable per post, so the pane reads once on open (and again only on Retry).
  const load = useCallback(() => loadComments(client, postId), [client, postId]);
  const send = useCallback(
    (body: string) => {
      if (!me) return Promise.reject(new Error('Not signed in'));
      return addComment(client, me, postId, body);
    },
    [client, me, postId],
  );

  /** Back to Home, or to the Home tab if there is nothing to go back to. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Comments</Heading>

      <CommentsPane load={load} send={send} me={me} onReport={(comment) => setReportingId(comment.id)} />

      {reportingId && me ? (
        <ReportSheet
          visible
          kind="comment"
          onSubmit={(reason, details) => reportComment(client, me, reportingId, reason, details)}
          onClose={() => setReportingId(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
});
