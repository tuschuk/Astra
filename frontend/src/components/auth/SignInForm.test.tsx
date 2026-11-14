/** SignInForm tests: submits credentials, shows friendly errors and notices, links to sign-up. */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { createFakeAuthClient } from '@/test-utils/fakeAuthClient';
import { renderWithAuth } from '@/test-utils/renderWithAuth';

import { SignInForm } from './SignInForm';

describe('SignInForm', () => {
  it('signs in with the typed email and password', async () => {
    const { screen, client } = await renderWithAuth(<SignInForm onGoToSignUp={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'lifter@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret123');
    await fireEvent.press(screen.getByLabelText('Sign in'));
    await waitFor(() =>
      expect(client.signInWithPassword).toHaveBeenCalledWith({ email: 'lifter@example.com', password: 'secret123' }),
    );
  });

  it('shows a friendly error for wrong credentials', async () => {
    const { screen } = await renderWithAuth(
      <SignInForm onGoToSignUp={jest.fn()} />,
      createFakeAuthClient({ signInError: { message: 'Invalid login credentials', code: 'invalid_credentials' } }),
    );
    await fireEvent.changeText(screen.getByLabelText('Email'), 'lifter@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
    await fireEvent.press(screen.getByLabelText('Sign in'));
    await waitFor(() => expect(screen.getByText(/don't match/)).toBeTruthy());
  });

  it('asks for both fields before calling the server', async () => {
    const { screen, client } = await renderWithAuth(<SignInForm onGoToSignUp={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Sign in'));
    await waitFor(() => expect(screen.getByText('Enter your email and password.')).toBeTruthy());
    expect(client.signInWithPassword).not.toHaveBeenCalled();
  });

  it('shows a notice handed over from sign-up', async () => {
    const { screen } = await renderWithAuth(<SignInForm onGoToSignUp={jest.fn()} notice="Check your email" />);
    expect(screen.getByText('Check your email')).toBeTruthy();
  });

  it('links to sign-up', async () => {
    const onGoToSignUp = jest.fn();
    const { screen } = await renderWithAuth(<SignInForm onGoToSignUp={onGoToSignUp} />);
    await fireEvent.press(screen.getByLabelText('Create an account'));
    expect(onGoToSignUp).toHaveBeenCalled();
  });
});
