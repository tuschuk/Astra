/**
 * usePostPhotoSource — how post cards fetch a photo post's picture as the signed-in viewer (B22),
 * shared by every screen that lists post cards (Home, and since B25 the profile).
 *
 * Returns a function from a photo's bucket path to what an `<Image>` needs (the authenticated
 * address plus the viewer's token), or null when there is no session or the app isn't configured
 * (only in Jest — in the app a missing address has already failed `getSupabase()` loudly); the card
 * then shows its plain "Photo unavailable" panel instead of crashing.
 */
import { useMemo } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { readSupabaseConfig, type SupabaseConfig } from '@/lib/supabase';
import { postImageSource, type PostImageSource } from '@/social/postImages';

export function usePostPhotoSource(): (imagePath: string) => PostImageSource | null {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  return useMemo(() => {
    let config: SupabaseConfig | null = null;
    try {
      config = readSupabaseConfig();
    } catch {
      config = null;
    }
    return (imagePath: string) => (config && accessToken ? postImageSource(config, imagePath, accessToken) : null);
  }, [accessToken]);
}
