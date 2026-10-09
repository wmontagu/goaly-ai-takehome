/**
 * claims.json names documents loosely ("pathology report"), while the
 * guideline keys are the formal names ("original pathology report"). This map
 * resolves them in code so the match never depends on an LLM guess (SPEC §4.3).
 */
export const DOC_ALIASES: Record<string, string> = {
  "pathology report": "original pathology report",
  "office note": "treating provider office note",
  "scene photos": "supplemental accident scene photos",
  "accident photos": "supplemental accident scene photos",
  estimate: "repair estimate",
};

export function canonicalDocName(name: string): string {
  const key = name.trim().toLowerCase();
  return DOC_ALIASES[key] ?? key;
}
