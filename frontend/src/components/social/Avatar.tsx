/**
 * Avatar — a lifter's round profile picture (YOU-1, B25), the one avatar renderer in the app.
 *
 * What it shows: their profile photo, from the avatars bucket's public address, when they have
 * set one; otherwise (or while the photo can't load) the red letter badge with their initial
 * (`LetterAvatar`). Two sizes: `small` beside a name on post cards and user cards, `large` at the
 * top of a profile.
 *
 * Decorative: the name printed next to it is what screen readers announce. Nothing to tap.
 */
import React, { useMemo, useState } from 'react';
import { Image, StyleSheet } from 'react-native';

import { LetterAvatar } from '@/components/social/LetterAvatar';
import { readSupabaseConfig } from '@/lib/supabase';
import { avatarPublicUrl } from '@/social/avatars';
import { colors, radii } from '@/theme';

/** The two sizes, in points. */
export const AVATAR_SIZES = { small: 36, large: 72 } as const;

interface AvatarProps {
  /** The photo's path in the avatars bucket, or null for none. */
  path: string | null;
  /** The letter shown when there is no photo (from `personLabels`). */
  initial: string;
  size?: keyof typeof AVATAR_SIZES;
}

/** The public address for `path`, or null when the app isn't configured (Jest without env) or there's no path. */
function photoUrl(path: string | null): string | null {
  if (!path) return null;
  try {
    return avatarPublicUrl(readSupabaseConfig().url, path);
  } catch {
    return null;
  }
}

export function Avatar({ path, initial, size = 'small' }: AvatarProps) {
  const uri = useMemo(() => photoUrl(path), [path]);
  // Which address failed to load — a new photo (new address) gets a fresh try.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const px = AVATAR_SIZES[size];
  if (!uri || failedUri === uri) return <LetterAvatar initial={initial} size={px} />;
  return (
    <Image
      testID="avatar-photo"
      source={{ uri }}
      style={[styles.photo, { width: px, height: px }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      onError={() => setFailedUri(uri)}
    />
  );
}

const styles = StyleSheet.create({
  photo: {
    borderRadius: radii.round,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
});
