/**
 * Tests for which screen a tapped push may open (B47): only the three shapes the server sends,
 * with a real id — anything else is ignored.
 */
import { describe, expect, it } from '@jest/globals';

import { pushTargetPath } from './notificationNav';

const ID = 'a0000000-0000-4000-8000-000000000001';

describe('pushTargetPath', () => {
  it('accepts the three screens a push opens', () => {
    expect(pushTargetPath({ path: `/profile/${ID}` })).toBe(`/profile/${ID}`);
    expect(pushTargetPath({ path: `/post-comments/${ID}` })).toBe(`/post-comments/${ID}`);
    expect(pushTargetPath({ path: `/team/${ID}` })).toBe(`/team/${ID}`);
  });

  it('refuses anything else', () => {
    expect(pushTargetPath({ path: '/settings' })).toBeNull();
    expect(pushTargetPath({ path: `/delete-account/${ID}` })).toBeNull();
    expect(pushTargetPath({ path: `/team/${ID}/invite` })).toBeNull();
    expect(pushTargetPath({ path: '/profile/not-an-id' })).toBeNull();
    expect(pushTargetPath({ path: `https://evil.example/profile/${ID}` })).toBeNull();
    expect(pushTargetPath({ path: 42 })).toBeNull();
    expect(pushTargetPath({})).toBeNull();
    expect(pushTargetPath(null)).toBeNull();
    expect(pushTargetPath('/profile/x')).toBeNull();
  });
});
