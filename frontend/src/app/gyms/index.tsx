/**
 * The gym directory (B50, GYM-1) — opened from Communities' **Find your gym**.
 *
 * What it shows: every gym, nearest first, as rows with the gym's name, its address and how far
 * away it is ("2.3 mi"). Tap a row to open that gym's page, where you can join it.
 *
 * Where "nearest" is measured from: when the directory opens it asks the phone for the lifter's
 * location — only now, never at launch, and only while the app is open ("foreground"). If the
 * lifter says yes, the list is sorted from where they are. If they say no, or the phone can't
 * find a position in time, it is sorted from downtown Denver and one line says so. The position
 * is kept only in this screen's memory and sent once, as the question to the server; it is
 * never saved anywhere, on the phone or the server.
 *
 * The sorting itself is the server's (a PostGIS distance query, `gyms_near`). Gyms live on the
 * server, so the directory needs a connection; without one it says so, with Retry.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { GymListItem } from '@/components/gyms/GymListItem';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading } from '@/components/ui/Text';
import { getSupabase } from '@/lib/supabase';
import { formatDistance, GYMS_OFFLINE, nearbyGyms, type NearbyGym } from '@/social/gyms';
import { spacing } from '@/theme';

/** Where the directory sorts from when the lifter's location isn't available: downtown Denver. */
export const DENVER = { lat: 39.7392, lng: -104.9903 } as const;

/** The line shown when the list is sorted from downtown Denver instead of the lifter. */
export const DENVER_FALLBACK_LINE =
  'Showing gyms near downtown Denver — allow location access to sort from where you are.';

/** How long to wait for the phone's position before falling back to Denver, in milliseconds. */
export const LOCATION_TIMEOUT_MS = 10_000;

/** A point to sort from, and whether it is the lifter's own position. */
interface Origin {
  lat: number;
  lng: number;
  fromUser: boolean;
}

/**
 * Asks for foreground location permission and, if given, a coarse position (a city-block guess
 * is plenty to sort gyms). Anything else — refused, failed, or slower than `LOCATION_TIMEOUT_MS`
 * — answers downtown Denver. Never throws.
 */
async function findOrigin(): Promise<Origin> {
  const denver: Origin = { ...DENVER, fromUser: false };
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return denver;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS);
    });
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      timeout,
    ]);
    clearTimeout(timer);
    if (!position) return denver;
    return { lat: position.coords.latitude, lng: position.coords.longitude, fromUser: true };
  } catch (error: unknown) {
    console.warn('Gyms: location unavailable, sorting from Denver', error);
    return denver;
  }
}

/** The directory: finding the location / loading, unreachable, or the sorted list. */
type DirectoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; gyms: NearbyGym[]; fromUser: boolean };

export default function GymDirectoryScreen() {
  const router = useRouter();
  const client = useMemo(() => getSupabase(), []);
  const [state, setState] = useState<DirectoryState>({ status: 'loading' });
  // Where the list was sorted from, so Retry after a dropped connection doesn't ask again.
  const origin = useRef<Origin | null>(null);

  // False once the screen has closed: a location or server answer arriving later is dropped.
  const open = useRef(true);

  /**
   * Finds where to sort from (once), then asks the server for the sorted list. The screen opens
   * in "loading"; Retry sets it back to loading before calling this.
   */
  const load = useCallback(async () => {
    origin.current ??= await findOrigin();
    const from = origin.current;
    try {
      const gyms = await nearbyGyms(client, from.lat, from.lng);
      if (open.current) setState({ status: 'ready', gyms, fromUser: from.fromUser });
    } catch (error: unknown) {
      console.warn('Gyms: the directory could not be loaded', error);
      if (open.current) setState({ status: 'error' });
    }
  }, [client]);

  useEffect(() => {
    open.current = true;
    void load();
    return () => {
      open.current = false;
    };
  }, [load]);

  /** Back to wherever the directory was opened from, or Communities. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/communities');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Find your gym</Heading>
      <Body variant="muted" style={styles.lede}>
        Join any gym — no proof of membership. You can belong to one at a time.
      </Body>

      {state.status === 'error' ? (
        <EmptyState
          icon="cloud-offline-outline"
          message={GYMS_OFFLINE}
          actionLabel="Retry"
          onAction={() => {
            setState({ status: 'loading' });
            void load();
          }}
        />
      ) : state.status === 'loading' ? (
        <Body variant="muted">Finding gyms near you…</Body>
      ) : (
        <View style={styles.list}>
          {state.fromUser ? null : <Body variant="small">{DENVER_FALLBACK_LINE}</Body>}
          {state.gyms.length === 0 ? (
            <Body variant="muted">No gyms are listed yet.</Body>
          ) : (
            state.gyms.map((gym) => (
              <GymListItem
                key={gym.id}
                gym={gym}
                detail={formatDistance(gym.distanceM)}
                onPress={() => router.push({ pathname: '/gym/[id]', params: { id: gym.id } })}
              />
            ))
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  lede: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
});
