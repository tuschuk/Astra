/**
 * Sign-up route (FND-2, NFR-8). Thin wiring only: renders SignUpForm and
 * goes back to sign-in when asked (carrying a notice when the account still
 * needs its email confirmed). A signup that returns a session needs no
 * navigation here — the root guard switches to the tabs.
 */
import React from 'react';
import { useRouter } from 'expo-router';

import { SignUpForm } from '@/components/auth/SignUpForm';

export default function SignUpScreen() {
  const router = useRouter();
  return (
    <SignUpForm
      onGoToSignIn={(notice) =>
        router.replace(notice ? { pathname: '/sign-in', params: { notice } } : '/sign-in')
      }
    />
  );
}
