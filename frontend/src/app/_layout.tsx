/**
 * Root layout — the app's outermost shell.
 *
 * Loads the three brand font families (Permanent Marker for headings,
 * Space Grotesk for UI text, Manrope for body copy), wraps everything in
 * AuthProvider (who is signed in), starts the on-device database and sync
 * engine (useSync), holds the splash screen until fonts and
 * the saved session are both ready, then mounts the router stack with the
 * signed-in tabs and the signed-out sign-in/sign-up screens behind guards.
 */
import React, { useEffect } from 'react';
import { ErrorBoundary as RouterErrorBoundary, Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { PermanentMarker_400Regular } from '@expo-google-fonts/permanent-marker';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { useSync } from '@/sync/useSync';
import { colors } from '@/theme';

// Keep the splash visible until fonts and the saved session are ready
// (hidden in RootNavigator's effect below).
SplashScreen.preventAutoHideAsync();

/**
 * Shown if the app shell itself crashes at startup — most likely a missing
 * Supabase setting in frontend/.env, which throws a message naming the
 * variable. Hides the splash first so that message is actually visible
 * instead of the app sitting on the splash forever, then shows expo-router's
 * standard error screen with a Retry button.
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);
  return <RouterErrorBoundary {...props} />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PermanentMarker_400Regular,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  // Proceed on error too: a failed font download must not strand the user on
  // the splash screen — system fonts render until the next successful load.
  const fontsReady = fontsLoaded || fontError != null;

  return (
    <AuthProvider>
      <RootNavigator fontsReady={fontsReady} />
    </AuthProvider>
  );
}

/**
 * The router stack, split into the two guarded halves of the app:
 * - (tabs), active-workout (the logger), workout/[id] (a saved workout),
 *   analysis/[id] (a finished workout's post-workout analysis, B18),
 *   post-workout/[id] (the Post step after the analysis — share or skip, B21),
 *   edit-workout/[id] (changing a saved workout, B14),
 *   exercise-history/[exerciseId] (one exercise's past sessions and PRs),
 *   exercise/[id] (a library exercise's card — cues, tips, muscles, B29),
 *   settings (units and account, B15), find-lifters (search people and follow
 *   them, B20), new-post (Share a photo — a progress pic or PR photo, B22) and
 *   post-comments/[id] (one post's comments, B23), profile/[id] (a lifter's
 *   profile, B25) and edit-profile (changing your own, B25), delete-account
 *   (B32), and the program builder (B34): programs (the list), program/[id]
 *   (one program's weeks and workouts) and program-workout/[id] (one program
 *   workout's exercises and targets): the signed-in app — only with a session.
 * - (auth): sign-in / sign-up — only without one.
 * When the session appears or disappears, expo-router moves the user to
 * whichever half is now allowed, so screens never navigate on sign-in/out.
 *
 * The splash stays up until fonts are ready AND the saved session has been
 * read, so a signed-in user never glimpses the sign-in screen at launch.
 * Restore always settles (failures count as signed-out), so it can't strand
 * the splash.
 */
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status, session } = useAuth();
  const ready = fontsReady && status !== 'restoring';

  // Opens the on-device database and, while signed in, keeps it in sync
  // with the server (src/sync/useSync.ts).
  useSync(session?.user.id ?? null);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  const signedIn = status === 'signedIn';
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          {/* The logger and the saved-workout view fill the screen, above the tab bar. */}
          <Stack.Screen name="active-workout" />
          <Stack.Screen name="workout/[id]" />
          <Stack.Screen name="analysis/[id]" />
          <Stack.Screen name="share-card/[id]" />
          <Stack.Screen name="post-workout/[id]" />
          <Stack.Screen name="edit-workout/[id]" />
          <Stack.Screen name="exercise-history/[exerciseId]" />
          <Stack.Screen name="exercise/[id]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="find-lifters" />
          <Stack.Screen name="new-post" />
          <Stack.Screen name="post-comments/[id]" />
          <Stack.Screen name="profile/[id]" />
          <Stack.Screen name="edit-profile" />
          <Stack.Screen name="delete-account" />
          <Stack.Screen name="programs" />
          <Stack.Screen name="program/[id]" />
          <Stack.Screen name="program-workout/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
