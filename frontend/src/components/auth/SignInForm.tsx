/**
 * SignInForm — the sign-in screen's content.
 *
 * Shows the Astra title, email and password fields, a Sign in button and a
 * link to create an account. On a wrong password (or no signal) it shows a
 * plain-language error under the fields. On success it does nothing itself:
 * AuthProvider's session changes and the root layout's route guard moves the
 * user into the tabs.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { TextField } from '@/components/ui/TextField';
import { Body, Heading } from '@/components/ui/Text';
import { colors } from '@/theme';

import { authFormStyles } from './formStyles';

interface SignInFormProps {
  /** Opens the sign-up screen. */
  onGoToSignUp: () => void;
  /** Optional notice shown above the form (e.g. "check your email"). */
  notice?: string;
}

export function SignInForm({ onGoToSignUp, notice }: SignInFormProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Sends the credentials; shows the friendly error if they're refused. */
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (!result.ok) setError(result.message);
  };

  return (
    <Screen contentStyle={authFormStyles.content}>
      <Heading size="display" style={authFormStyles.title}>
        Astra
      </Heading>
      <Body variant="muted">Sign in to log, track and share your training.</Body>
      {notice ? <Body style={styles.notice}>{notice}</Body> : null}

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
          autoComplete="current-password"
          textContentType="password"
        />
      </View>

      <FormError message={error} />

      <Button label={submitting ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={submitting} />
      <Button label="Create an account" variant="ghost" onPress={onGoToSignUp} disabled={submitting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: {
    color: colors.info,
  },
});
