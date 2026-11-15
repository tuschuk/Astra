/**
 * Tests for NewProgramForm (B34): Create stays disabled until there is a name, a name past the
 * 100-character limit (counted the server's way) is refused with a message, and Create saves a
 * trimmed program on the phone and hands it back. Real SQLite; no network.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ProgramRow } from '@/db/dao';
import { listPrograms } from '@/programs/programs';
import { createPreparedDb } from '@/test-utils/loggerTestKit';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import { NewProgramForm, programNameTooLong } from './NewProgramForm';

const USER = 'a0000000-0000-4000-8000-000000000001';

describe('programNameTooLong', () => {
  it('is false for empty and up to 100 characters (emoji count once), true past it', () => {
    expect(programNameTooLong('')).toBe(false);
    expect(programNameTooLong('x'.repeat(100))).toBe(false);
    expect(programNameTooLong('🏋'.repeat(100))).toBe(false);
    expect(programNameTooLong('x'.repeat(101))).toBe(true);
  });
});

describe('NewProgramForm', () => {
  it('needs a name, refuses an over-long one, and creates a trimmed program', async () => {
    const db = await createPreparedDb();
    const onCreated = jest.fn<(p: ProgramRow) => void>();
    await render(
      <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
        <NewProgramForm visible db={db} userId={USER} onCreated={onCreated} onClose={() => undefined} />
      </SafeAreaProvider>,
    );
    expect(screen.getByLabelText('Create program').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText('Program name'), 'x'.repeat(101));
    expect(screen.getByText('Names can be at most 100 characters.')).toBeTruthy();
    expect(screen.getByLabelText('Create program').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.changeText(screen.getByLabelText('Program name'), ' 5/3/1 ');
    await fireEvent.press(screen.getByLabelText('Create program'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0][0]).toMatchObject({ name: '5/3/1', user_id: USER, deleted_at: null });
    expect((await listPrograms(db, USER)).map((s) => s.program.name)).toEqual(['5/3/1']);
  });
});
