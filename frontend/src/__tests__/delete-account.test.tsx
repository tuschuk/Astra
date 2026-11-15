/**
 * The Delete account screen (B32, NFR-6), through the real screen and auth provider:
 *   - it names the signed-in account and keeps the button locked until DELETE is typed;
 *   - a confirmed delete calls the server function, and only after its "deleted" answer wipes
 *     the phone (sign-out first, inside `wipeDeviceData`);
 *   - a failed or offline delete shows a calm line and wipes nothing.
 * The server call and the wipe are fakes; nothing touches a real project or the phone's files.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { DELETE_FAILED, DELETE_OFFLINE } from '@/account/deleteAccount';
import { renderSignedIn } from '@/test-utils/loggerTestKit';

import DeleteAccountScreen, { DELETE_WARNING, DELETED_REOPEN_LINE } from '@/app/delete-account';

const mockInvoke = jest.fn<(name: string, options?: { body?: unknown }) => Promise<{ data: unknown; error: unknown }>>();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => ({ functions: { invoke: mockInvoke } }),
}));

const mockWipe = jest.fn<(signOut: () => Promise<unknown>) => Promise<{ signedOut: boolean }>>();
jest.mock('@/db/wipeDevice', () => ({ wipeDeviceData: (signOut: () => Promise<unknown>) => mockWipe(signOut) }));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

beforeEach(() => {
  jest.clearAllMocks();
  mockWipe.mockResolvedValue({ signedOut: true });
});

/** The red button. */
function deleteButton() {
  return screen.getByRole('button', { name: 'Delete my account' });
}

describe('Delete account screen', () => {
  it('names the account, says what goes, and stays locked until DELETE is typed', async () => {
    await renderSignedIn(<DeleteAccountScreen />);
    expect(await screen.findByText('lifter@example.com')).toBeTruthy();
    expect(screen.getByText(DELETE_WARNING)).toBeTruthy();
    expect(deleteButton().props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    expect(deleteButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(deleteButton());
    expect(mockInvoke).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(deleteButton().props.accessibilityState.disabled).toBe(false);
  });

  it('deletes on the server, then wipes the phone', async () => {
    mockInvoke.mockResolvedValue({ data: { deleted: { userId: 'u', filesRemoved: 0 } }, error: null });
    await renderSignedIn(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(deleteButton());
    await waitFor(() => expect(mockWipe).toHaveBeenCalledTimes(1));
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', { body: { confirm: 'DELETE' } });
    // The wipe is handed the auth provider's sign-out.
    expect(typeof mockWipe.mock.calls[0][0]).toBe('function');
  });

  it('shows a calm line and wipes nothing when the server fails', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', context: { status: 500 } } });
    await renderSignedIn(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(deleteButton());
    expect(await screen.findByText(DELETE_FAILED)).toBeTruthy();
    expect(mockWipe).not.toHaveBeenCalled();
    expect(deleteButton().props.accessibilityState.disabled).toBe(false);
  });

  it('says it needs a connection when offline, and wipes nothing', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });
    await renderSignedIn(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(deleteButton());
    expect(await screen.findByText(DELETE_OFFLINE)).toBeTruthy();
    expect(mockWipe).not.toHaveBeenCalled();
  });

  it('says to reopen Astra, and stays locked, if the phone could not sign out after the delete', async () => {
    mockInvoke.mockResolvedValue({ data: { deleted: { userId: 'u', filesRemoved: 0 } }, error: null });
    mockWipe.mockResolvedValue({ signedOut: false });
    await renderSignedIn(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(deleteButton());
    expect(await screen.findByText(DELETED_REOPEN_LINE)).toBeTruthy();
    expect(deleteButton().props.accessibilityState.disabled).toBe(true);
  });

  it('goes back to Settings, from Back or from Export your data first', async () => {
    await renderSignedIn(<DeleteAccountScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Export your data first' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(2);
  });
});
