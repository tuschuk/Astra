/**
 * Share a photo — post a progress pic or a PR photo to the feed (SOC-2, NFR-4, NFR-5; B22).
 * Opened from the "Share a photo" button on Home.
 *
 * What it shows:
 *   - two choices of post type: **Progress pic** and **PR photo**;
 *   - a line saying who will see it — a progress pic goes to whoever the lifter chose in
 *     Settings → Privacy (only them unless they changed it, B26), a PR photo posts publicly.
 *     Either can be changed afterwards from the post's own card;
 *   - **Choose photo**, which opens the phone's photo library, then a preview of the pick;
 *   - **Post** and **Cancel**.
 *
 * What the lifter can do: pick the type, choose (or re-choose) a photo, Post, or Cancel.
 *
 * The size limit (NFR-4): a photo over 10 MB, or in a format the feed can't show, is refused the
 * moment it is picked, with a sentence saying why ("This photo is 12.4 MB — the limit is 10 MB.
 * Choose a smaller photo.") and Post stays disabled. The server's bucket refuses it as well — this
 * is only the friendly early warning.
 *
 * Posting is instant: Post saves the post and a copy of the photo on the phone, queued for upload,
 * and returns to Home straight away. The sync engine uploads the photo and then the post in the
 * background — right away with signal, or whenever the phone reconnects — while the lifter keeps
 * using the app. The very first Post on this phone also asks, once, whether Astra may send push
 * notifications (B47, `askOnce.ts`). If the flair list has never synced to this phone (near-impossible), Post is
 * disabled with a line saying so.
 */
import React, { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { FlairRow, ImagePostKind, WorkoutVisibility } from '@/db/dao';
import { readFlairs } from '@/db/flairs';
import { useAppDatabase } from '@/db/useAppDatabase';
import { maybeAskForPushOnce } from '@/notifications/askOnce';
import { readProgressPicVisibility } from '@/settings/privacySettings';
import { createImagePost, IMAGE_POST_DEFAULTS, PostRefusedError, type PickedImage } from '@/social/createPost';
import { checkPostImage, mimeTypeForPath } from '@/social/mediaLimits';
import { fileSizeOf } from '@/social/postImages';
import { VISIBILITY_WORDS } from '@/social/postPrivacy';
import { colors, radii, spacing } from '@/theme';

/** The two post types, in the order the chips show them, with their labels. */
const TYPES: { kind: ImagePostKind; label: string }[] = [
  { kind: 'progress-pic', label: 'Progress pic' },
  { kind: 'pr', label: 'PR photo' },
];

/**
 * Who will see the post — said before posting so the privacy state is never a surprise.
 * A PR photo posts publicly. A progress pic follows the lifter's choice in Settings → Privacy
 * (B26), `picVisibility`: "Only you can see this post." / "Your followers can see this post." /
 * "Anyone on Astra can see this post.", plus where that choice is changed.
 */
export function privacyLine(kind: ImagePostKind, picVisibility: WorkoutVisibility): string {
  if (kind === 'pr') return 'PR photos post publicly.';
  return `${VISIBILITY_WORDS[picVisibility].meaning}. Choose who sees new progress pics in Settings.`;
}

/**
 * Turns the photo library's pick into what the size check needs. The picker usually reports the
 * size and format; when it doesn't, the size is read from the file and the format guessed from
 * its file ending.
 */
async function toPickedImage(asset: ImagePicker.ImagePickerAsset): Promise<PickedImage> {
  return {
    uri: asset.uri,
    byteSize: asset.fileSize ?? (await fileSizeOf(asset.uri)),
    mimeType: asset.mimeType ?? mimeTypeForPath(asset.uri),
  };
}

export default function NewPostScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db } = useAppDatabase();
  const [kind, setKind] = useState<ImagePostKind>('progress-pic');
  const [flairs, setFlairs] = useState<FlairRow[] | null>(null);
  const [image, setImage] = useState<PickedImage | null>(null);
  // The size/format refusal for the current pick, shown under the preview.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Who new progress pics go to (B26) — 'private' until the phone's setting has been read, the
  // same value the post itself would fall back to.
  const [picVisibility, setPicVisibility] = useState<WorkoutVisibility>('private');

  useFocusEffect(
    useCallback(() => {
      if (!db) return;
      let cancelled = false;
      readFlairs(db)
        .then((rows) => {
          if (!cancelled) setFlairs(rows);
        })
        .catch((caught: unknown) => {
          console.warn('Share a photo: could not read the flair list', caught);
          if (!cancelled) setFlairs([]);
        });
      if (userId) {
        readProgressPicVisibility(db, userId)
          .then((value) => {
            if (!cancelled) setPicVisibility(value);
          })
          .catch((caught: unknown) => {
            console.warn('Share a photo: could not read the privacy setting', caught);
          });
      }
      return () => {
        cancelled = true;
      };
    }, [db, userId]),
  );

  const flair = flairs?.find((f) => f.id === IMAGE_POST_DEFAULTS[kind].flairId) ?? null;

  /**
   * Opens the photo library. `quality` below 1 makes iOS re-encode its HEIC photos to JPEG, a
   * format every phone in the feed can show. The pick is checked against the limits at once.
   */
  async function choosePhoto(): Promise<void> {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: false,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const picked = await toPickedImage(result.assets[0]);
      const check = checkPostImage(picked);
      setImage(picked);
      setRefusal(check.ok ? null : check.message);
    } catch (caught) {
      console.warn('Share a photo: the photo library could not be opened', caught);
      setError('Your photos couldn’t be opened. Check that Astra may use your photos, then try again.');
    }
  }

  /** Saves the post (queued for upload in the background) and returns to Home. One tap = one post. */
  async function post(): Promise<void> {
    if (!db || !userId || !image || refusal || !flair || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createImagePost(db, userId, kind, image);
      // B47: the first Post is when push becomes worth asking for — once per phone, never awaited.
      void maybeAskForPushOnce(userId);
      router.replace('/');
    } catch (caught) {
      if (caught instanceof PostRefusedError && caught.reason === 'image-refused') {
        setRefusal(caught.message);
      } else {
        console.warn('Share a photo: could not save the post', caught);
        setError('The post couldn’t be saved. Try again.');
      }
      setBusy(false);
    }
  }

  /** Back to Home without posting. */
  function cancel(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const noFlairs = flairs !== null && !flair;

  return (
    <Screen>
      <Heading>Share a photo</Heading>
      <Body variant="muted" style={styles.message}>
        Post a progress pic or a PR moment to your feed.
      </Body>

      <SectionLabel size="small" style={styles.label}>
        Type
      </SectionLabel>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {TYPES.map((type) => (
          <TypeChip key={type.kind} label={type.label} selected={type.kind === kind} onPress={() => setKind(type.kind)} />
        ))}
      </View>
      <Body variant="small" style={styles.privacy}>
        {privacyLine(kind, picVisibility)}
        {flair ? ` Flair: ${flair.name}.` : ''}
      </Body>

      {image ? (
        <Image source={{ uri: image.uri }} style={styles.preview} resizeMode="cover" accessibilityLabel="Chosen photo" />
      ) : null}
      <FormError message={refusal} />
      <Button label={image ? 'Choose another photo' : 'Choose photo'} variant="ghost" onPress={choosePhoto} disabled={busy} />

      {noFlairs ? (
        <Body variant="small" style={styles.noFlairs}>
          Flairs haven’t synced to this phone yet, so posting isn’t available. Connect and try again.
        </Body>
      ) : null}
      <FormError message={error} />
      <Button label="Post" onPress={post} disabled={busy || !image || refusal !== null || !flair} style={styles.post} />
      <Button label="Cancel" variant="ghost" onPress={cancel} disabled={busy} style={styles.cancel} />
    </Screen>
  );
}

/** One post type as a tappable chip; the picked one is filled red. */
function TypeChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <SectionLabel size="small" style={styles.chipText}>
        {label}
      </SectionLabel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  message: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  label: {
    color: colors.accent,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  chipSelected: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
  },
  chipText: {
    color: colors.text,
  },
  privacy: {
    color: colors.muted,
    marginBottom: spacing.lg,
  },
  preview: {
    width: '100%',
    height: 280,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  noFlairs: {
    color: colors.muted,
    marginTop: spacing.md,
  },
  post: {
    marginTop: spacing.lg,
  },
  cancel: {
    marginTop: spacing.md,
  },
});
