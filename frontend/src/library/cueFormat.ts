/**
 * Coaching-cue formatting — turns the founder's `**bold**` emphasis markers into plain spans.
 *
 * The imported coaching steps carry emphasis as `**…**` (e.g. "Lie flat. **Eyes under the bar**,
 * feet planted."). The exercise detail screen draws those as bold text, so it needs the cue split
 * into "plain, bold, plain…" pieces. A markdown library for one marker would be a dependency for
 * nothing, so this owned splitter does exactly that and no more.
 */

/** One piece of a cue: its text and whether it is emphasised. */
export interface CueSegment {
  text: string;
  bold: boolean;
}

/**
 * Split cue text into plain and bold pieces.
 *
 * Input: a cue string. Output: its pieces in order; empty pieces are dropped. Only complete
 * `**…**` pairs become bold — a stray `**` with no partner stays in the text literally, so a typo
 * in the data shows up as written instead of swallowing the rest of the sentence.
 */
export function boldSegments(text: string): CueSegment[] {
  const segments: CueSegment[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), bold: false });
    segments.push({ text: match[1], bold: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false });
  return segments;
}
