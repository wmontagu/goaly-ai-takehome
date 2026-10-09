/**
 * The agent's actions, gated by a per-phase allowlist (SPEC §7, layer 2).
 * Engine code calls these, never the LLM directly, and any call outside the
 * current phase's allowlist is rejected and logged, the same pattern as the
 * harness guardrail. Pre-verification there is simply no tool that returns
 * claim data.
 */
import { claimsForParty, findClaim, findPolicyholder, type Claim, type ConsentStatus } from "@/apps/insurance_claims/data";
import { getEmailSender, type SendResult } from "@/lib/email";
import { caseTypeGuidance, documentGuidance, type DocumentGuidance } from "@/lib/domain/guidance";
import { consentStatusAt } from "@/lib/domain/representative";
import { addTrace } from "@/lib/trace";
import type { Session } from "@/lib/sop/session";
import type { Phase } from "@/lib/sop/state-machine";

export type ToolName =
  | "get_claims"
  | "get_claim_detail"
  | "get_document_guidance"
  | "request_policyholder_consent"
  | "send_email_summary"
  | "transfer_to_human"
  | "end_conversation";

const ALWAYS: ToolName[] = ["transfer_to_human", "end_conversation"];

export const TOOL_ALLOWLIST: Record<Phase, ToolName[]> = {
  VERIFY_ID: ["request_policyholder_consent", ...ALWAYS],
  RESOLVE_INTENT: ["get_claims", ...ALWAYS],
  PROCESS_CASE: ["get_claims", "get_claim_detail", "get_document_guidance", ...ALWAYS],
  POST_PROCESS: ["send_email_summary", ...ALWAYS],
  TRANSFERRED: [],
  ENDED: [],
};

export class ToolRejected extends Error {}

function authorize(session: Session, tool: ToolName, extra?: () => string | null): void {
  const reason = !TOOL_ALLOWLIST[session.phase].includes(tool)
    ? `${tool} is not allowed in ${session.phase}`
    : (extra?.() ?? null);
  if (reason) {
    addTrace(session, "tool_rejected", reason, { tool, phase: session.phase });
    throw new ToolRejected(reason);
  }
}

function verifiedParty(session: Session): string {
  const id = session.memory.verified_party_id;
  if (!id) throw new ToolRejected("No verified party");
  return id;
}

export type ClaimIndexEntry = Pick<Claim, "case_id" | "case_type" | "created_at" | "status" | "summary">;

export function getClaims(session: Session): ClaimIndexEntry[] {
  authorize(session, "get_claims", () => (session.memory.verified_party_id ? null : "caller not verified"));
  const index = claimsForParty(verifiedParty(session)).map(({ case_id, case_type, created_at, status, summary }) => ({
    case_id,
    case_type,
    created_at,
    status,
    summary,
  }));
  addTrace(session, "tool", `get_claims → ${index.length} claims`, { case_ids: index.map((c) => c.case_id) });
  return index;
}

export function getClaimDetail(session: Session, caseId: string): Claim {
  authorize(session, "get_claim_detail");
  const claim = findClaim(verifiedParty(session), caseId);
  if (!claim) throw new ToolRejected(`${caseId} is not this caller's claim`);
  addTrace(session, "tool", `get_claim_detail(${caseId})`);
  return claim;
}

export function getDocumentGuidance(session: Session, claim: Claim): {
  documents: DocumentGuidance[];
  case_type_guidance: string | null;
} {
  authorize(session, "get_document_guidance");
  addTrace(session, "tool", `get_document_guidance(${claim.case_id})`);
  return { documents: documentGuidance(claim), case_type_guidance: caseTypeGuidance(claim) };
}

export function requestPolicyholderConsent(session: Session): ConsentStatus {
  authorize(session, "request_policyholder_consent");
  const status = consentStatusAt(session.consentScenario, session.memory.consent.polls);
  session.memory.consent.polls += 1;
  session.memory.consent.status = status;
  addTrace(session, "tool", `request_policyholder_consent → ${status}`, {
    scenario: session.consentScenario,
    poll: session.memory.consent.polls,
  });
  return status;
}

export async function sendEmailSummary(
  session: Session,
  email: { subject: string; text: string; html: string },
): Promise<SendResult & { to: string }> {
  authorize(session, "send_email_summary", () =>
    session.memory.email.decision === "send" ? null : "customer has not said yes to the email",
  );
  const holder = findPolicyholder(verifiedParty(session));
  if (!holder) throw new ToolRejected("No policyholder on file");
  // Always the email on file (SPEC §4.4), never an address typed in chat.
  const to = holder.email;
  const sender = getEmailSender();
  let result: SendResult;
  try {
    result = await sender.send({ to, ...email, sessionId: session.id });
  } catch {
    result = { id: "", status: "failed" };
  }
  session.outbox.push({ id: result.id, to, ...email, status: result.status, provider: sender.provider, turn: session.turn });
  addTrace(session, "tool", `send_email_summary → ${result.status}`, { provider: sender.provider, id: result.id });
  return { ...result, to };
}

export function transferToHuman(session: Session, reason: string): void {
  authorize(session, "transfer_to_human");
  session.endReason = reason;
  addTrace(session, "tool", `transfer_to_human (${reason})`);
}

export function endConversation(session: Session, reason: string): void {
  authorize(session, "end_conversation");
  session.endReason = reason;
  addTrace(session, "tool", `end_conversation (${reason})`);
}
