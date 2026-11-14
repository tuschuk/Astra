/**
 * Root layout — the app's outermost shell.
 *
 * Loads the three brand font families (Permanent Marker for headings,
 * Space Grotesk for UI text, Manrope for body copy), wraps everything in
 * AuthProvider (who is signed in), holds the splash screen until fonts and
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
 * - (tabs): the five-tab app — only with a session.
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
  const { status } = useAuth();
  const ready = fontsReady && status !== 'restoring';

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
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
