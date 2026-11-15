/**
 * B22's step definition of done, walked through the real Share a photo screen, real SQLite and
 * the stand-in server:
 *
 *   - rejection half: an over-limit photo is refused the moment it is picked, with the exact
 *     `mediaLimits` sentence; Post stays disabled and nothing is written;
 *   - upload half: an accepted photo's Post returns to Home at once, having only saved the post,
 *     the photo's copy and the outbox line on the phone — the upload happens afterwards, in the
 *     sync engine's push (photo first, then the post), exactly once.
 *
 * Plus the type choice (progress pics private by default, PR photos public, each with its flair),
 * (B26) a progress pic born with the lifter's Settings choice, and the empty-flairs guard. The photo library and the file copy are stubbed at their seams; the router
 * is a stub. Route files live in `src/app/`, so their tests live here.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { replaceFlairsTx } from '@/db/flairs';
import { setProgressPicVisibility } from '@/settings/privacySettings';
import { checkPostImage, MAX_POST_IMAGE_BYTES } from '@/social/mediaLimits';
import { outboxSize, pendingRows } from '@/sync/outbox';
import { pushOutbox } from '@/sync/push';
import { FakePostImageFiles } from '@/test-utils/fakePostImageFiles';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import NewPostScreen, { privacyLine } from '@/app/new-post';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

// What the photo library hands back on the next pick.
let mockPick: { canceled: boolean; assets: { uri: string; fileSize?: number; mimeType?: string }[] | null };
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => mockPick,
}));

// The phone's files, in memory: the screen's copy goes here, and the push reads it back.
const mockFiles = new FakePostImageFiles();
jest.mock('@/social/postImages', () => ({
  ...jest.requireActual<typeof import('@/social/postImages')>('@/social/postImages'),
  savePostImageLocally: (source: string, path: string) => mockFiles.save(source, path),
  fileSizeOf: async () => null,
}));

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  mockFiles.files.clear();
  mockPick = { canceled: false, assets: [{ uri: 'file:///cache/pick.jpg', fileSize: 2_500_000, mimeType: 'image/jpeg' }] };
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
  await db.withTransactionAsync((tx) => replaceFlairsTx(tx, new FakeServer().flairs));
});

async function postRows() {
  return db.getAllAsync<{ kind: string; visibility: string; flair_id: string; image_path: string }>(
    'select kind, visibility, flair_id, image_path from posts',
  );
}

describe('Share a photo (B22)', () => {
  it('rejects an over-limit photo with the clear message; Post stays disabled and nothing is written', async () => {
    mockPick = { canceled: false, assets: [{ uri: 'file:///cache/huge.jpg', fileSize: MAX_POST_IMAGE_BYTES + 1, mimeType: 'image/jpeg' }] };
    await renderSignedIn(<NewPostScreen />);
    await fireEvent.press(await screen.findByLabelText('Choose photo'));
    const expected = checkPostImage({ byteSize: MAX_POST_IMAGE_BYTES + 1, mimeType: 'image/jpeg' });
    if (expected.ok) throw new Error('expected a refusal');
    expect(await screen.findByText(expected.message)).toBeTruthy();
    expect(expected.message).toBe('This photo is 10.1 MB — the limit is 10 MB. Choose a smaller photo.');

    expect(screen.getByLabelText('Post')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Post'));
    expect(await postRows()).toEqual([]);
    expect(await outboxSize(db)).toBe(0);
    expect(mockFiles.files.size).toBe(0);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('refuses a HEIC photo that slipped past the picker, by format', async () => {
    mockPick = { canceled: false, assets: [{ uri: 'file:///cache/x.heic', fileSize: 1000, mimeType: 'image/heic' }] };
    await renderSignedIn(<NewPostScreen />);
    await fireEvent.press(await screen.findByLabelText('Choose photo'));
    expect(await screen.findByText(/format isn’t supported/)).toBeTruthy();
    expect(screen.getByLabelText('Post')).toBeDisabled();
  });

  it('an accepted progress pic: Post returns to Home at once with only local work done; the push uploads photo then post, once', async () => {
    await renderSignedIn(<NewPostScreen />);
    expect(await screen.findByText(privacyLine('progress-pic', 'private'), { exact: false })).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('Choose photo'));
    expect(await screen.findByLabelText('Chosen photo')).toBeTruthy();

    const server = new FakeServer();
    await fireEvent.press(screen.getByLabelText('Post'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));

    // Back on Home already — and nothing has gone to the server: only the phone was written.
    expect(server.requestLog).toEqual([]);
    const [row] = await postRows();
    expect(row).toMatchObject({ kind: 'progress-pic', visibility: 'private', flair_id: 'physique-check' });
    expect(row.image_path.startsWith(`${SIGNED_IN_USER_ID}/`)).toBe(true);
    expect(await pendingRows(db, 'posts')).toHaveLength(1);
    expect(mockFiles.files.size).toBe(1);

    // The background upload (what the sync engine runs after the write).
    expect((await pushOutbox(db, server, mockFiles)).posts).toBe(1);
    expect(server.requestLog.filter((r) => !r.startsWith('upsert'))).toEqual([`image:${row.image_path}`, expect.stringMatching(/^post:/)]);
    expect(server.objects.size).toBe(1);
    expect(server.posts.size).toBe(1);
    expect((await pushOutbox(db, server, mockFiles)).posts).toBe(0);
    expect(mockFiles.files.size).toBe(0);
  });

  it('PR photo: public, with the New PR flair', async () => {
    await renderSignedIn(<NewPostScreen />);
    await fireEvent.press(await screen.findByLabelText('PR photo'));
    expect(await screen.findByText(privacyLine('pr', 'private'), { exact: false })).toBeTruthy();
    expect(screen.getByText(/Flair: New PR\./)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Choose photo'));
    await screen.findByLabelText('Chosen photo');
    await fireEvent.press(screen.getByLabelText('Post'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(await postRows()).toEqual([expect.objectContaining({ kind: 'pr', visibility: 'public', flair_id: 'new-pr' })]);
  });

  it('B26: with Followers chosen in Settings, the line says so and the progress pic is born followers-only, then uploads so', async () => {
    await setProgressPicVisibility(db, SIGNED_IN_USER_ID, 'followers');
    await renderSignedIn(<NewPostScreen />);
    expect(await screen.findByText('Your followers can see this post. Choose who sees new progress pics in Settings.', { exact: false })).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('Choose photo'));
    await screen.findByLabelText('Chosen photo');
    await fireEvent.press(screen.getByLabelText('Post'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(await postRows()).toEqual([expect.objectContaining({ kind: 'progress-pic', visibility: 'followers' })]);

    // The stand-in server takes it as chosen (B22's private-only CHECK is gone).
    const server = new FakeServer();
    await pushOutbox(db, server, mockFiles);
    expect([...server.posts.values()].map((p) => p.visibility)).toEqual(['followers']);
  });

  it('a cancelled pick changes nothing; Cancel goes back', async () => {
    mockPick = { canceled: true, assets: null };
    await renderSignedIn(<NewPostScreen />);
    await fireEvent.press(await screen.findByLabelText('Choose photo'));
    expect(screen.queryByLabelText('Chosen photo')).toBeNull();
    expect(screen.getByLabelText('Post')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('with no flairs synced, Post is disabled with an explanation', async () => {
    await db.runAsync('delete from flairs'); // a phone that has never synced them
    await renderSignedIn(<NewPostScreen />);
    expect(await screen.findByText(/Flairs haven’t synced/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Choose photo'));
    await screen.findByLabelText('Chosen photo');
    expect(screen.getByLabelText('Post')).toBeDisabled();
  });
});
