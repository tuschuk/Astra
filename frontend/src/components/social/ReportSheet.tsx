/**
 * ReportSheet — the panel for reporting a post or a comment (SOC-8, B27).
 *
 * What it shows: "Report post" (or "Report comment"), the six reasons from the content policy as
 * chips (Spam, Harassment, Nudity or sexual content, Not about training, Impersonation, Something
 * else) with a sentence explaining the chosen one, an optional details box (up to 500 characters,
 * a counter near the limit), and Send report / Cancel.
 *
 * What the lifter can do: pick a reason (Send stays off until they do), add details if they want,
 * and send. While it sends, the button says so and can't be pressed twice. Then:
 *   - it went through → a thank-you line, a reminder that muting or blocking lives on the
 *     lifter's profile, and Done;
 *   - it didn't → a calm sentence under the button, and they can try again.
 * Reports go to the founder's queue on the server; the person reported is never told who
 * reported them.
 *
 * The sheet doesn't know how to file a report — the card or comment row that opened it passes
 * `onSubmit` (which calls `report` in `social/moderation.ts`). It opens fresh every time.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { Body, Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import {
  detailsTooLong,
  REPORT_COUNTER_FROM,
  REPORT_DETAILS_MAX_CHARS,
  REPORT_REASONS,
  REPORT_THANKS,
  REPORT_TOO_LONG,
  type ReportReason,
  type ReportResult,
} from '@/social/moderation';
import { colors, spacing } from '@/theme';

/** The line after a successful report pointing to the profile's mute / block. */
export const REPORT_NEXT_STEP = 'Don’t want to see this lifter? Mute or block them from their profile.';

/** The reasons as chips, each spoken with its explanation. */
const REASON_OPTIONS: ChoiceOption<ReportReason>[] = REPORT_REASONS.map((r) => ({
  value: r.value,
  label: r.label,
  spoken: `${r.label}: ${r.meaning}`,
}));

interface ReportSheetProps {
  /** Whether the panel is open. */
  visible: boolean;
  /** What is being reported — only changes the heading. */
  kind: 'post' | 'comment';
  /** Files the report; resolves with how it went. */
  onSubmit: (reason: ReportReason, details: string) => Promise<ReportResult>;
  /** Closes the panel (Cancel, Done, or the system back button). */
  onClose: () => void;
}

export function ReportSheet({ visible, kind, onSubmit, onClose }: ReportSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      {/* Mounted fresh on every open, so a second report starts blank. */}
      <SheetBody kind={kind} onSubmit={onSubmit} onClose={onClose} />
    </Modal>
  );
}

/** Where the sheet stands: choosing, sending, thanked, or refused (with the sentence). */
type Phase = { step: 'picking' } | { step: 'sending' } | { step: 'thanked' } | { step: 'refused'; message: string };

/** The panel's contents. */
function SheetBody({ kind, onSubmit, onClose }: Omit<ReportSheetProps, 'visible'>) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [phase, setPhase] = useState<Phase>({ step: 'picking' });

  const tooLong = detailsTooLong(details);
  const length = [...details].length;
  const canSend = reason != null && !tooLong && phase.step !== 'sending';
  const chosen = REPORT_REASONS.find((r) => r.value === reason);

  /** Sends the report once; shows thanks or the refusal. */
  async function send(): Promise<void> {
    if (!canSend || reason == null) return;
    setPhase({ step: 'sending' });
    const result = await onSubmit(reason, details);
    setPhase(result.ok ? { step: 'thanked' } : { step: 'refused', message: result.message });
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Heading size="section">{kind === 'post' ? 'Report post' : 'Report comment'}</Heading>

        {phase.step === 'thanked' ? (
          <>
            <Body>{REPORT_THANKS}</Body>
            <Body variant="small" style={styles.muted}>
              {REPORT_NEXT_STEP}
            </Body>
            <Button label="Done" onPress={onClose} style={styles.button} />
          </>
        ) : (
          <>
            <Body variant="small" style={styles.muted}>
              What’s wrong with it? Reports are reviewed against Astra’s content policy. The lifter isn’t told who reported.
            </Body>
            <ChoiceChips options={REASON_OPTIONS} selected={reason} onSelect={setReason} disabled={phase.step === 'sending'} />
            {chosen ? (
              <Body variant="small" style={styles.muted}>
                {chosen.meaning}
              </Body>
            ) : null}

            <TextField
              label="Details (optional)"
              placeholder="Anything that helps the review"
              value={details}
              onChangeText={setDetails}
              // No `maxLength`: it would count an emoji as two; the counter and the line guide instead.
              multiline
            />
            {length >= REPORT_COUNTER_FROM ? <Body variant="small">{`${length} / ${REPORT_DETAILS_MAX_CHARS}`}</Body> : null}
            {tooLong ? (
              <Body variant="small" style={styles.muted}>
                {REPORT_TOO_LONG}
              </Body>
            ) : null}
            {phase.step === 'refused' ? (
              <Body variant="small" style={styles.muted}>
                {phase.message}
              </Body>
            ) : null}

            <View style={styles.actions}>
              <Button
                label={phase.step === 'sending' ? 'Sending…' : 'Send report'}
                onPress={() => void send()}
                disabled={!canSend}
                style={styles.button}
              />
              <Button label="Cancel" variant="ghost" onPress={onClose} style={styles.button} />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  muted: {
    color: colors.muted,
  },
  actions: {
    gap: spacing.sm,
  },
  button: {
    alignSelf: 'stretch',
  },
});
