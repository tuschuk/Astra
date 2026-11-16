/**
 * Where a tapped push notification takes the lifter (B47).
 *
 * Every push the `notify` server function sends carries one piece of data: the in-app screen it
 * is about — a follower's profile, a post's comments, a Team's page, or (B48) the direct-message
 * thread with the lifter who wrote. Tapping the notification opens Astra on that screen.
 *
 * Why the path is checked here rather than trusted: a notification arrives from outside the app,
 * so the screen it names is only followed if it is exactly one of the four shapes the server
 * sends, with a real id. Anything else is ignored and the app simply opens where it was.
 */

/** The four screens a push can open, each `/<screen>/<uuid>`. */
const PUSH_PATH = /^\/(profile|post-comments|team|messages)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The screen path in a notification's data, if it is one a push may open; otherwise null.
 * Input: the notification's `data` object (anything). Output: the path, or null.
 */
export function pushTargetPath(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const path = (data as { path?: unknown }).path;
  return typeof path === 'string' && PUSH_PATH.test(path) ? path : null;
}
