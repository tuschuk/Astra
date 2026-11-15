/**
 * How another lifter is named on screen — the one spelling the feed's post cards and the
 * Find lifters cards share.
 */

/** The two names a person can have: the unique @username and the free-text display name (either may be unset). */
export interface PersonName {
  username: string | null;
  displayName: string | null;
}

/**
 * The name a person goes by on a card, their @handle, and the letter in their letter avatar:
 * the display name if they set one, else the username, else "Lifter" (an account that hasn't
 * chosen either yet). The handle is null without a username. The letter is the name's first
 * whole character, so a name starting with an emoji shows that emoji, not half of it.
 */
export function personLabels(person: PersonName): { name: string; handle: string | null; initial: string } {
  const name = person.displayName?.trim() || person.username || 'Lifter';
  return {
    name,
    handle: person.username ? `@${person.username}` : null,
    initial: (Array.from(name)[0] ?? '').toUpperCase(),
  };
}
