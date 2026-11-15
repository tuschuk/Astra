/**
 * Tests for the avatar (B25): a set photo path shows the public-bucket picture; no path, no
 * configured address, or a picture that fails to load shows the letter badge.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Avatar } from './Avatar';

const HIDDEN = { includeHiddenElements: true };
const saved = { ...process.env };

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

afterEach(() => {
  process.env = { ...saved };
});

describe('Avatar', () => {
  it('shows the photo from the public avatars address when a path is set', async () => {
    await render(<Avatar path="u1/face.jpg" initial="S" size="large" />);
    const photo = screen.getByTestId('avatar-photo', HIDDEN);
    expect(photo.props.source).toEqual({ uri: 'https://proj.supabase.co/storage/v1/object/public/avatars/u1/face.jpg' });
    expect(photo.props.style).toEqual(expect.arrayContaining([{ width: 72, height: 72 }]));
  });

  it('shows the letter without a path', async () => {
    await render(<Avatar path={null} initial="S" />);
    expect(screen.getByText('S', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('avatar-photo', HIDDEN)).toBeNull();
  });

  it('falls back to the letter when the photo fails to load', async () => {
    await render(<Avatar path="u1/face.jpg" initial="S" />);
    await fireEvent(screen.getByTestId('avatar-photo', HIDDEN), 'error');
    expect(screen.getByTestId('letter-avatar', HIDDEN)).toBeTruthy();
  });

  it('falls back to the letter when the app has no server address', async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    await render(<Avatar path="u1/face.jpg" initial="S" />);
    expect(screen.getByTestId('letter-avatar', HIDDEN)).toBeTruthy();
  });
});
