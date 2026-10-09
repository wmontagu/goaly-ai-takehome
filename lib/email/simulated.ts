import { randomUUID } from "crypto";
import type { EmailMessage, EmailSender, SendResult } from "./types";

/**
 * Delivers nowhere. The engine records every send in the session's
 * server-side outbox, which the UI renders as an email preview card.
 */
export class SimulatedEmailSender implements EmailSender {
  readonly provider = "simulated";

  async send(msg: EmailMessage): Promise<SendResult> {
    void msg;
    return { id: `sim-${randomUUID()}`, status: "sent" };
  }
}
