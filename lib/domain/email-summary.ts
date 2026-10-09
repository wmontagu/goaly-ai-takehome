/**
 * Email summary schema + fixed template (SPEC §8). The LLM only fills the
 * schema; the layout, greeting, and PII masking are deterministic here.
 */
import { z } from "zod";

export const EmailSummarySchema = z.object({
  subject: z.string(),
  discussed: z.array(z.string()),
  claim_status_outcome: z.string(),
  next_steps: z.array(z.string()),
});
export type EmailSummary = z.infer<typeof EmailSummarySchema>;

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user[0]}${"*".repeat(Math.max(user.length - 1, 3))}@${domain}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderEmail(
  summary: EmailSummary,
  opts: { firstName: string; caseId: string | null },
): { subject: string; text: string; html: string } {
  const ref = opts.caseId ? ` (claim ${opts.caseId})` : "";
  const list = (items: string[]) => items.map((i) => `  - ${i}`).join("\n");
  const text = [
    `Hi ${opts.firstName},`,
    "",
    `Here is a summary of your call with claims support${ref}.`,
    "",
    "What we discussed:",
    list(summary.discussed),
    "",
    "Claim status / outcome:",
    `  ${summary.claim_status_outcome}`,
    "",
    "Next steps:",
    list(summary.next_steps),
    "",
    "For your security, this email doesn't include your date of birth or ID number.",
    "Claims Support",
  ].join("\n");

  const li = (items: string[]) => items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const html = [
    `<p>Hi ${escapeHtml(opts.firstName)},</p>`,
    `<p>Here is a summary of your call with claims support${escapeHtml(ref)}.</p>`,
    `<h3>What we discussed</h3><ul>${li(summary.discussed)}</ul>`,
    `<h3>Claim status / outcome</h3><p>${escapeHtml(summary.claim_status_outcome)}</p>`,
    `<h3>Next steps</h3><ul>${li(summary.next_steps)}</ul>`,
    `<p><small>For your security, this email doesn't include your date of birth or ID number.</small></p>`,
  ].join("");

  return { subject: summary.subject, text, html };
}
