/** FormError tests: renders nothing without a message, an alert with one. */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

import { FormError } from './FormError';

describe('FormError', () => {
  it('renders nothing when there is no message', async () => {
    const screen = await render(<FormError message={null} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('shows the message as an alert', async () => {
    const screen = await render(<FormError message="Nope" />);
    expect(screen.getByText('Nope')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
