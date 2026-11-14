/** BirthdateInput tests: three labeled boxes, digits only, each box updates only its own part. */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { BirthdateInput } from './BirthdateInput';

const EMPTY = { month: '', day: '', year: '' };

describe('BirthdateInput', () => {
  it('renders month, day and year boxes', async () => {
    const screen = await render(<BirthdateInput value={EMPTY} onChange={() => {}} />);
    for (const label of ['Birth month', 'Birth day', 'Birth year']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('updates only the edited part and strips non-digits', async () => {
    const onChange = jest.fn();
    const screen = await render(<BirthdateInput value={{ month: '3', day: '7', year: '' }} onChange={onChange} />);
    await fireEvent.changeText(screen.getByLabelText('Birth year'), '19a9-5');
    expect(onChange).toHaveBeenCalledWith({ month: '3', day: '7', year: '1995' });
  });
});
