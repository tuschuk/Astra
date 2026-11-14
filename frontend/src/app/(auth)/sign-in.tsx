/**
 * Sign-in route (FND-2). Thin wiring only: renders SignInForm, passes along
 * any notice handed over by sign-up ("check your email"), and opens sign-up.
 * Successful sign-in needs no navigation here — the root guard switches to
 * the tabs once the session exists.
 */
import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { SignInForm } from '@/components/auth/SignInForm';

export default function SignInScreen() {
  const router = useRouter();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  return <SignInForm notice={notice} onGoToSignUp={() => router.push('/sign-up')} />;
}
