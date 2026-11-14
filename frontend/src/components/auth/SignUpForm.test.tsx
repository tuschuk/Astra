/**
 * SignUpForm tests: the 18+ gate shows its clear message and never calls the
 * server; a valid signup sends the birthdate; the email-confirmation path
 * hands over to sign-in with a notice.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { UNDER_AGE_MESSAGE } from '@/auth/age';
import { createFakeAuthClient } from '@/test-utils/fakeAuthClient';
import { renderWithAuth } from '@/test-utils/renderWithAuth';

import { CONFIRM_EMAIL_NOTICE, SignUpForm } from './SignUpForm';

type Screen = Awaited<ReturnType<typeof renderWithAuth>>['screen'];

async function fill(screen: Screen, birth: { month: string; day: string; year: string }) {
  await fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'secret123');
  await fireEvent.changeText(screen.getByLabelText('Birth month'), birth.month);
  await fireEvent.changeText(screen.getByLabelText('Birth day'), birth.day);
  await fireEvent.changeText(screen.getByLabelText('Birth year'), birth.year);
}

describe('SignUpForm', () => {
  it('tells the user up front that Astra is 18+', async () => {
    const { screen } = await renderWithAuth(<SignUpForm onGoToSignIn={jest.fn()} />);
    expect(screen.getByText(/18 and older/)).toBeTruthy();
  });

  it('refuses an under-18 birthdate with the clear message and never calls signUp', async () => {
    const { screen, client } = await renderWithAuth(<SignUpForm onGoToSignIn={jest.fn()} />);
    await fill(screen, { month: '11', day: '15', year: '2008' });
    await fireEvent.press(screen.getByLabelText('Create account'));
    await waitFor(() => expect(screen.getByText(UNDER_AGE_MESSAGE)).toBeTruthy());
    expect(client.signUp).not.toHaveBeenCalled();
  });

  it('creates the account with the birthdate for an 18+ user', async () => {
    const { screen, client } = await renderWithAuth(<SignUpForm onGoToSignIn={jest.fn()} />);
    await fill(screen, { month: '3', day: '7', year: '1995' });
    await fireEvent.press(screen.getByLabelText('Create account'));
    await waitFor(() =>
      expect(client.signUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'secret123',
        options: { data: { birthdate: '1995-03-07' } },
      }),
    );
  });

  it('strips non-digits typed into the birthdate boxes', async () => {
    const { screen } = await renderWithAuth(<SignUpForm onGoToSignIn={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Birth year'), '19a9-5');
    expect(screen.getByLabelText('Birth year').props.value).toBe('1995');
  });

  it('hands over to sign-in with a notice when email confirmation is required', async () => {
    const onGoToSignIn = jest.fn();
    const { screen } = await renderWithAuth(
      <SignUpForm onGoToSignIn={onGoToSignIn} />,
      createFakeAuthClient({ requireEmailConfirmation: true }),
    );
    await fill(screen, { month: '3', day: '7', year: '1995' });
    await fireEvent.press(screen.getByLabelText('Create account'));
    await waitFor(() => expect(onGoToSignIn).toHaveBeenCalledWith(CONFIRM_EMAIL_NOTICE));
  });

  it('shows the server refusal as a friendly message', async () => {
    const { screen } = await renderWithAuth(
      <SignUpForm onGoToSignIn={jest.fn()} />,
      createFakeAuthClient({ signUpError: { message: 'User already registered', code: 'user_already_exists' } }),
    );
    await fill(screen, { month: '3', day: '7', year: '1995' });
    await fireEvent.press(screen.getByLabelText('Create account'));
    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
  });

  it('links back to sign-in', async () => {
    const onGoToSignIn = jest.fn();
    const { screen } = await renderWithAuth(<SignUpForm onGoToSignIn={onGoToSignIn} />);
    await fireEvent.press(screen.getByLabelText('I already have an account'));
    expect(onGoToSignIn).toHaveBeenCalledWith();
  });
});
