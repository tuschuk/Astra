/**
 * Tests for the report panel (B27, SOC-8): Send stays off until a reason is picked; the chosen
 * reason's sentence shows; the reason and details reach `onSubmit` once even on a double tap;
 * success shows the thank-you and the mute/block pointer; a refusal shows its sentence and lets
 * the lifter try again; too-long details turn Send off with the limit line.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { REPORT_DETAILS_MAX_CHARS, REPORT_FAILED, REPORT_THANKS, REPORT_TOO_LONG, type ReportResult } from '@/social/moderation';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import { REPORT_NEXT_STEP, ReportSheet } from './ReportSheet';

/** Renders an open sheet with the given submit handler. */
async function open(onSubmit: (reason: string, details: string) => Promise<ReportResult>, onClose = jest.fn()) {
  await render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <ReportSheet visible kind="comment" onSubmit={onSubmit} onClose={onClose} />
    </SafeAreaProvider>,
  );
  return onClose;
}

/** Is the Send button off? */
function sendDisabled(): boolean {
  return screen.getByLabelText('Send report').props.accessibilityState?.disabled === true;
}

describe('ReportSheet', () => {
  it('needs a reason before it can send; the chosen reason is explained', async () => {
    await open(async () => ({ ok: true }));
    expect(screen.getByText('Report comment')).toBeTruthy();
    expect(sendDisabled()).toBe(true);
    await fireEvent.press(screen.getByLabelText(/^Harassment:/));
    expect(screen.getByText('Bullying, threats, hate, or targeting someone.')).toBeTruthy();
    expect(sendDisabled()).toBe(false);
  });

  it('sends the reason and details once, then thanks the lifter and points at mute/block', async () => {
    let finish: (r: ReportResult) => void = () => {};
    const onSubmit = jest.fn((_reason: string, _details: string) => new Promise<ReportResult>((resolve) => (finish = resolve)));
    const onClose = await open(onSubmit);
    await fireEvent.press(screen.getByLabelText(/^Spam:/));
    await fireEvent.changeText(screen.getByLabelText('Details (optional)'), 'same link every day');
    await fireEvent.press(screen.getByLabelText('Send report'));
    await fireEvent.press(screen.getByLabelText('Sending…'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('spam', 'same link every day');
    await act(async () => finish({ ok: true }));
    expect(screen.getByText(REPORT_THANKS)).toBeTruthy();
    expect(screen.getByText(REPORT_NEXT_STEP)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('a refusal shows its sentence and the lifter can try again', async () => {
    const onSubmit = jest
      .fn<(reason: string, details: string) => Promise<ReportResult>>()
      .mockResolvedValueOnce({ ok: false, message: REPORT_FAILED })
      .mockResolvedValueOnce({ ok: true });
    await open(onSubmit);
    await fireEvent.press(screen.getByLabelText(/^Something else:/));
    await fireEvent.press(screen.getByLabelText('Send report'));
    expect(await screen.findByText(REPORT_FAILED)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Send report'));
    expect(await screen.findByText(REPORT_THANKS)).toBeTruthy();
  });

  it('too-long details turn Send off and say the limit', async () => {
    await open(async () => ({ ok: true }));
    await fireEvent.press(screen.getByLabelText(/^Spam:/));
    await fireEvent.changeText(screen.getByLabelText('Details (optional)'), 'a'.repeat(REPORT_DETAILS_MAX_CHARS + 1));
    expect(screen.getByText(REPORT_TOO_LONG)).toBeTruthy();
    expect(screen.getByText(`${REPORT_DETAILS_MAX_CHARS + 1} / ${REPORT_DETAILS_MAX_CHARS}`)).toBeTruthy();
    expect(sendDisabled()).toBe(true);
  });

  it('Cancel closes without sending', async () => {
    const onSubmit = jest.fn(async () => ({ ok: true }) as ReportResult);
    const onClose = await open(onSubmit);
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
