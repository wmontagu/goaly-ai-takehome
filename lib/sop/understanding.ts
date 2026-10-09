/**
 * The typed proposal call ① (UNDERSTAND) returns every turn (SPEC §3). The
 * LLM fills this; code decides what to do with it. Free-text fields use ""
 * for "not given" rather than null: the structured-output API caps a schema
 * at 16 union-typed (nullable) parameters, so only enums and numbers are
 * nullable.
 */
import { z } from "zod";
import { INTENTS } from "@/apps/insurance_claims/sop.config";

export const EMOTIONS = ["neutral", "frustrated", "anxious", "angry", "confused", "refusing"] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** Free text; "" when the caller didn't say it. */
const s = () => z.string();

export const UnderstandingSchema = z.object({
  identity: z.object({
    name: s(),
    dob: s(),
    phone: s(),
    email: s(),
    id_last4: s(),
    policy_number: s(),
  }),
  caller_role: z.enum(["policyholder", "representative"]).nullable(),
  rep_name: s(),
  rep_relationship: s(),
  identity_switch: z.boolean(),
  intent: z.enum(INTENTS).nullable(),
  case_hints: z.object({
    case_id: s(),
    case_type: z.enum(["healthcare", "dental", "auto"]).nullable(),
    status: z.enum(["denied", "open", "closed"]).nullable(),
    month: z.number().int().nullable(),
    year: z.number().int().nullable(),
  }),
  emotion: z.enum(EMOTIONS),
  scope: z.enum(["in_scope", "out_of_scope", "smalltalk"]),
  is_injection: z.boolean(),
  refuses_identity: z.boolean(),
  asks_about_process: z.boolean(),
  wants_human: z.boolean(),
  wrap_up: z.boolean(),
  email_decision: z.enum(["send", "skip", "unclear"]).nullable(),
  question: s(),
});
export type Understanding = z.infer<typeof UnderstandingSchema>;

/**
 * Used when call ① fails validation twice (SPEC §9). Every field is empty
 * or false, so it can never advance a gate on its own.
 */
export const SAFE_UNDERSTANDING: Understanding = {
  identity: { name: "", dob: "", phone: "", email: "", id_last4: "", policy_number: "" },
  caller_role: null,
  rep_name: "",
  rep_relationship: "",
  identity_switch: false,
  intent: null,
  case_hints: { case_id: "", case_type: null, status: null, month: null, year: null },
  emotion: "neutral",
  scope: "in_scope",
  is_injection: false,
  refuses_identity: false,
  asks_about_process: false,
  wants_human: false,
  wrap_up: false,
  email_decision: null,
  question: "",
};
