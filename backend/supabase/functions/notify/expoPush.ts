/**
 * The shape of Expo's free push service, kept apart from the decisions in `handler.ts` so it can
 * be tested on its own (B47).
 *
 * How Expo's service works, in brief: we POST a list of messages (at most 100 per request) to
 * `https://exp.host/--/api/v2/push/send`; each message names one phone by its Expo push token.
 * Expo answers straight away with one "ticket" per message, in the same order: either
 * `{ status: 'ok', id }` (accepted — Expo will hand it to Apple or Google) or
 * `{ status: 'error', message, details: { error } }`. The one error we must act on is
 * `DeviceNotRegistered`: that phone uninstalled the app or turned push off, so its token must be
 * forgotten. (A later "receipt" check is possible with the ticket id; we keep the ids but don't
 * poll — see plan decision 8.)
 */

/** Where messages are sent. */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo's cap on messages in one request. */
export const EXPO_BATCH_LIMIT = 100;

/** One message to one phone. `data.path` is the in-app screen a tap opens — nothing else rides along. */
export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: { path: string };
}

/** Expo's answer for one message. */
export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

/** Builds the message for one phone. */
export function buildMessage(token: string, title: string, body: string, path: string): ExpoMessage {
  return { to: token, title, body, sound: 'default', data: { path } };
}

/** Splits `items` into lists of at most `size` (100 for Expo), keeping the order. */
export function chunk<T>(items: readonly T[], size = EXPO_BATCH_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Reads Expo's reply to one request into one ticket per message sent, in order. A reply that is
 * not the expected shape (an outage page, a whole-request error, the wrong count) becomes an
 * error ticket for every message, so the caller records the send as failed rather than guessing.
 */
export function parseTickets(reply: unknown, sentCount: number): ExpoTicket[] {
  const data = (reply as { data?: unknown } | null)?.data;
  if (Array.isArray(data) && data.length === sentCount) {
    return data.map((raw): ExpoTicket => {
      const t = raw as { status?: unknown; id?: unknown; message?: unknown; details?: { error?: unknown } };
      if (t?.status === 'ok' && typeof t.id === 'string') return { status: 'ok', id: t.id };
      const error = typeof t?.details?.error === 'string' ? t.details.error : undefined;
      return { status: 'error', message: typeof t?.message === 'string' ? t.message : 'Unknown error', details: { error } };
    });
  }
  return Array.from({ length: sentCount }, (): ExpoTicket => ({ status: 'error', message: 'Unreadable reply from Expo' }));
}

/** True when Expo says this phone can no longer receive pushes, so its token should be deleted. */
export function isDeviceNotRegistered(ticket: ExpoTicket): boolean {
  return ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered';
}
