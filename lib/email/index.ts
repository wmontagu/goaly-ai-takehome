import { SimulatedEmailSender } from "./simulated";
import type { EmailSender } from "./types";

export type { EmailMessage, EmailSender, SendResult } from "./types";

/** Picks the sender from EMAIL_PROVIDER. Only "simulated" ships. */
export function getEmailSender(): EmailSender {
  const provider = (process.env.EMAIL_PROVIDER || "simulated").toLowerCase();
  switch (provider) {
    case "simulated":
      return new SimulatedEmailSender();
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${provider}". Only "simulated" is implemented.`);
  }
}
