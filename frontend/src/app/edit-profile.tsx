/**
 * Edit profile (YOU-1, B25) — opened from the Edit profile button on your own profile.
 *
 * What it shows: your current profile photo with **Change photo**, and three boxes — Display
 * name, Username and Bio — filled with what the server has now; then **Save** and **Cancel**.
 *
 * What the user can do:
 *   - change the photo: the phone's photo library opens with a square crop. A photo over 5 MB, or
 *     in a format other than JPEG / PNG / WebP, is refused the moment it is picked, with a sentence
 *     saying why, and Save stays disabled until another is chosen;
 *   - change the text. Each box says under it what's wrong (too long; a username that isn't 3–30
 *     letters, numbers or underscores; a username someone else already has). A username, once
 *     set, can be changed but not removed — every card in the app prints it;
 *   - Save: the new photo (if any) is uploaded first, then the profile is saved, then the old
 *     photo is cleaned up. Back to your profile when done; on any failure, nothing is half-saved
 *     on the profile and a message says what to do.
 *
 * Saving needs a connection (like comments and votes, nothing is queued) — without one the screen
 * says so and offers Retry.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Avatar, AVATAR_SIZES } from '@/components/social/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase, readSupabaseConfig } from '@/lib/supabase';
import { avatarObjectPath, deleteAvatar, uploadAvatar } from '@/social/avatars';
import { checkAvatarImage, mimeTypeForPath, type PostImageMimeType } from '@/social/mediaLimits';
import { personLabels } from '@/social/names';
import { saveOwnProfile } from '@/social/ownProfileCache';
import { fileSizeOf } from '@/social/postImages';
import { loadProfileRow, updateProfile, type ProfileIdentity } from '@/social/profile';
import { checkProfileText, MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH, type ProfileField } from '@/social/profileLimits';
import { colors, radii, spacing } from '@/theme';

/** Shown when the new photo didn't reach the server. */
export const AVATAR_UPLOAD_FAILED = 'Your new photo didn’t upload. Check your connection and try again.';

/** A photo picked on this screen: where it is on the phone, and the check's answer. */
type PickedAvatar =
  | { uri: string; ok: true; mimeType: PostImageMimeType }
  | { uri: string; ok: false; message: string };

/** Loading the current profile, it failed, or the form is showing. */
type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; original: ProfileIdentity };

/**
 * How many characters a box lets the lifter type: twice the server's limit. The real check is
 * `checkProfileText` (it counts whole characters and says what's wrong); this only stops a paste
 * of a novel. Twice, because the box counts emoji as two and must never cut off a legal name.
 */
const TYPING_ALLOWANCE = 2;

export default function EditProfileScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const accessToken = session?.access_token ?? null;
  const client = useMemo(() => getSupabase(), []);

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [picked, setPicked] = useState<PickedAvatar | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Bumped by Retry, to read the profile again.
  const [attempt, setAttempt] = useState(0);

  // Reads the profile as the server has it now, and fills the boxes with it.
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    loadProfileRow(client, me)
      .then((header) => {
        if (!header) throw new Error('Your profile row is missing');
        if (cancelled) return;
        setDisplayName(header.displayName ?? '');
        setUsername(header.username ?? '');
        setBio(header.bio ?? '');
        setLoad({ status: 'ready', original: header });
      })
      .catch((caught: unknown) => {
        console.warn('Edit profile: could not load the current profile', caught);
        if (!cancelled) setLoad({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [client, me, attempt]);

  /** Back to the profile, or the You tab if there's nothing to go back to. */
  function leave(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/you');
  }

  /**
   * Opens the photo library with a square crop. `quality` below 1 makes iOS re-encode its HEIC
   * photos to JPEG (the B22 arrangement). The pick is checked against the avatar limits at once.
   */
  async function choosePhoto(): Promise<void> {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
        exif: false,
      });
      const asset = result.canceled ? null : result.assets?.[0];
      if (!asset) return;
      const check = checkAvatarImage({
        byteSize: asset.fileSize ?? (await fileSizeOf(asset.uri)),
        mimeType: asset.mimeType ?? mimeTypeForPath(asset.uri),
      });
      setPicked(check.ok ? { uri: asset.uri, ok: true, mimeType: check.mimeType } : { uri: asset.uri, ok: false, message: check.message });
    } catch (caught: unknown) {
      console.warn('Edit profile: the photo library could not be opened', caught);
      setError('Your photos couldn’t be opened. Check that Astra may use your photos, then try again.');
    }
  }

  /** Checks, uploads the new photo (if any), saves the profile, then cleans up the old photo. */
  async function save(): Promise<void> {
    if (!me || load.status !== 'ready' || saving || (picked && !picked.ok)) return;
    const { original } = load;
    const text = checkProfileText({ displayName, username, bio }, original.username !== null);
    if (!text.ok) {
      setErrors(text.errors);
      return;
    }
    setErrors({});
    setError(null);
    setSaving(true);

    let newPath: string | null = null;
    if (picked?.ok) {
      try {
        if (!accessToken) throw new Error('Not signed in');
        newPath = avatarObjectPath(me, picked.mimeType);
        await uploadAvatar(readSupabaseConfig(), accessToken, picked.uri, newPath, picked.mimeType);
      } catch (caught: unknown) {
        console.warn('Edit profile: the photo upload failed', caught);
        setError(AVATAR_UPLOAD_FAILED);
        setSaving(false);
        return;
      }
    }

    const avatarPath = newPath ?? original.avatarPath;
    const result = await updateProfile(client, me, { ...text.values, avatarPath });
    if (!result.ok) {
      // The profile didn't take the new photo, so it would only be litter in the bucket.
      if (newPath && accessToken) void deleteAvatar(readSupabaseConfig(), accessToken, newPath);
      if (result.field) setErrors({ [result.field]: result.message });
      else setError(result.message);
      setSaving(false);
      return;
    }
    if (newPath && original.avatarPath && accessToken) {
      void deleteAvatar(readSupabaseConfig(), accessToken, original.avatarPath);
    }
    saveOwnProfile(me, { ...text.values, avatarPath });
    setSaving(false);
    leave();
  }

  if (load.status !== 'ready') {
    return (
      <Screen>
        <Heading>Edit profile</Heading>
        {load.status === 'error' ? (
          <EmptyState
            icon="cloud-offline-outline"
            message="Editing your profile needs a connection."
            actionLabel="Retry"
            onAction={() => {
              setLoad({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          />
        ) : (
          <Body variant="muted">Loading your profile…</Body>
        )}
        <Button label="Cancel" variant="ghost" onPress={leave} style={styles.cancel} />
      </Screen>
    );
  }

  const who = personLabels({ username: username || null, displayName: displayName || null });
  const shownPath = load.original.avatarPath;

  return (
    <Screen>
      <Heading>Edit profile</Heading>

      <View style={styles.photoRow}>
        {picked ? (
          <PickedPreview uri={picked.uri} />
        ) : (
          <Avatar path={shownPath} initial={who.initial} size="large" />
        )}
        <Button label="Change photo" variant="ghost" onPress={() => void choosePhoto()} disabled={saving} />
      </View>
      <FormError message={picked && !picked.ok ? picked.message : null} />

      <TextField
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        maxLength={MAX_DISPLAY_NAME_LENGTH * TYPING_ALLOWANCE}
        style={styles.field}
      />
      <FormError message={errors.displayName ?? null} />
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.field}
      />
      <FormError message={errors.username ?? null} />
      <TextField
        label="Bio"
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={MAX_BIO_LENGTH * TYPING_ALLOWANCE}
        style={styles.field}
      />
      <FormError message={errors.bio ?? null} />

      <FormError message={error} />
      <Button
        label={saving ? 'Saving…' : 'Save'}
        onPress={() => void save()}
        disabled={saving || (picked !== null && !picked.ok)}
        style={styles.save}
      />
      <Button label="Cancel" variant="ghost" onPress={leave} disabled={saving} style={styles.cancel} />
    </Screen>
  );
}

/** The just-picked photo, round like the avatar it will become. */
function PickedPreview({ uri }: { uri: string }) {
  return (
    <View style={styles.previewFrame}>
      <Image source={{ uri }} style={styles.preview} accessibilityLabel="Chosen photo" />
    </View>
  );
}

const styles = StyleSheet.create({
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  previewFrame: {
    width: AVATAR_SIZES.large,
    height: AVATAR_SIZES.large,
    borderRadius: radii.round,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  preview: {
    width: AVATAR_SIZES.large,
    height: AVATAR_SIZES.large,
  },
  field: {
    marginTop: spacing.lg,
  },
  save: {
    marginTop: spacing.xl,
  },
  cancel: {
    marginTop: spacing.md,
  },
});
