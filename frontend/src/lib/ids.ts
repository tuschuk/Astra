/**
 * Making new ids for rows the phone creates (a workout, an exercise slot, a set).
 *
 * Why the phone makes ids itself: workouts are logged offline, so a row needs its permanent id
 * the moment it is saved on the device — long before the server sees it. The server then
 * insert-or-updates by that id, which is what makes a retried upload never create a duplicate.
 *
 * Why random v4 UUIDs from `expo-crypto`: two phones must never pick the same id (a collision
 * would merge two people's sets into one row). A v4 UUID from the operating system's secure
 * random generator makes that practically impossible; `Math.random` or a timestamp would not.
 * React Native's JavaScript engine (Hermes) has no dependable built-in `crypto.randomUUID`, so
 * the Expo module supplies it.
 */
import { randomUUID } from 'expo-crypto';

/** Returns a brand-new random id (RFC 4122 version 4 UUID, lower-case text). */
export function newUuid(): string {
  return randomUUID();
}
