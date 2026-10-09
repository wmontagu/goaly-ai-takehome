/**
 * The only email surface the SOP engine sees (SPEC §8). Swapping in a real
 * provider means adding one implementation and setting EMAIL_PROVIDER; no
 * SOP code changes.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  sessionId: string;
};

export type SendResult = { id: string; status: "sent" | "failed" };

export interface EmailSender {
  readonly provider: string;
  send(msg: EmailMessage): Promise<SendResult>;
}
