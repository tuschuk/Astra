/**
 * SignUpForm — the create-account screen's content.
 *
 * Collects email, password and birthdate, states up front that Astra is 18+,
 * and has a link back to sign-in. Pressing "Create account" runs the 18+ age
 * gate first: an under-18 or impossible birthdate is refused right here with a
 * clear message and nothing is sent to the server.
 *
 * On success the user is normally signed in straight away (the route guard
 * moves them into the tabs). If the project requires email confirmation, no
 * session comes back, so this hands over to sign-in with a "check your email"
 * notice instead.
 */
import React, { useState } from 'react';
import { View } from 'react-native';

import type { BirthdateFields } from '@/auth/age';
import { useAuth } from '@/auth/AuthProvider';
import { PASSWORD_MIN_LENGTH } from '@/auth/password';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { TextField } from '@/components/ui/TextField';
import { Body, Heading } from '@/components/ui/Text';

import { BirthdateInput } from './BirthdateInput';
import { authFormStyles } from './formStyles';

/** Shown on sign-in after a signup that needs its email confirmed. */
export const CONFIRM_EMAIL_NOTICE = 'Check your email to confirm your account, then sign in.';

interface SignUpFormProps {
  /** Opens the sign-in screen, optionally with a notice to show there. */
  onGoToSignIn: (notice?: string) => void;
}

export function SignUpForm({ onGoToSignIn }: SignUpFormProps) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [birthdate, setBirthdate] = useState<BirthdateFields>({ month: '', day: '', year: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Runs the age gate and, if it passes, creates the account. */
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await signUp({ email, password, birthdate });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
    } else if (result.needsEmailConfirmation) {
      onGoToSignIn(CONFIRM_EMAIL_NOTICE);
    }
  };

  return (
    <Screen contentStyle={authFormStyles.content}>
      <Heading style={authFormStyles.title}>Create your account</Heading>
      <Body variant="muted">Astra is for lifters 18 and older. Your birthdate stays private.</Body>

      <View style={authFormStyles.fields}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <Body variant="small">At least {PASSWORD_MIN_LENGTH} characters.</Body>
        <BirthdateInput value={birthdate} onChange={setBirthdate} />
      </View>

      <FormError message={error} />

      <Button label={submitting ? 'Creating account…' : 'Create account'} onPress={submit} disabled={submitting} />
      <Button
        label="I already have an account"
        variant="ghost"
        onPress={() => onGoToSignIn()}
        disabled={submitting}
      />
    </Screen>
  );
}
