/**
 * Turns a reply into the chunks Call mode speaks, one utterance each. The
 * voice pauses between utterances, so every line, list item, sentence, and
 * spaced dash gets its own chunk; flattening it all into one line made the
 * agent run list items together. Small chunks also dodge Chrome cutting off
 * utterances after ~15s.
 */

const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;
/** A spaced hyphen, or an en/em dash: "denied — here's why". Not CL-2048 or 2026-03-18. */
const DASH_PAUSE = /\s+[-–—]\s+|\s*[—–]\s*/;

export function spokenChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(LIST_MARKER, "").replace(/[*_#`]/g, "").trim();
    if (!line) continue;
    for (const piece of line.split(DASH_PAUSE)) {
      // A sentence ends at . ! ? followed by a space, so "$1,234.56" stays whole.
      for (const sentence of piece.split(/(?<=[.!?]["')\]]?)\s+/)) {
        const s = sentence.replace(/\s+/g, " ").trim();
        if (/[a-z0-9]/i.test(s)) chunks.push(s);
      }
    }
  }
  return chunks;
}
