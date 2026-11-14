/**
 * Auth group layout — the signed-out side of the app: sign-in and sign-up.
 *
 * Only reachable without a session (the root layout's guard enforces that).
 * Sign-in is listed first so it's where a signed-out user lands.
 */
import React from 'react';
import { Stack } from 'expo-router';

import { colors } from '@/theme';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
