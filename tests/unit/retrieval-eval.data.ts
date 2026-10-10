/**
 * Retrieval evaluation set: realistic caller questions, each labelled with
 * the chunk(s) that correctly answer it (any one counts). Phrasings are
 * deliberately varied: synonyms ("car" for auto), dates in words, slang for
 * statuses, and questions that never name the field they want.
 *
 * Labels refer to fixture records because this set evaluates retrieval on
 * this fixture data; the retrieval code itself knows no IDs.
 */
export type EvalCase = { party: string; q: string; want: string[] };

const C = (id: string, part: "overview" | "denial" | "amounts") => `claim:${id}:${part}`;

export const EVAL_SET: EvalCase[] = [
  // Account
  { party: "P9", q: "what's my policy number?", want: ["account:P9"] },
  { party: "P9", q: "can you remind me of my policy #", want: ["account:P9"] },
  { party: "P9", q: "what name is the account under", want: ["account:P9"] },
  { party: "P12", q: "what is my policy number", want: ["account:P12"] },
  { party: "P13", q: "I forgot my policy number", want: ["account:P13"] },

  // Denials, documents, deadlines
  { party: "P9", q: "why was my claim denied?", want: [C("CL-2048", "denial"), C("CL-2048", "overview")] },
  { party: "P9", q: "why did you reject my medical claim", want: [C("CL-2048", "denial"), C("CL-2048", "overview")] },
  { party: "P9", q: "what documents do I need to send for the denied claim", want: [C("CL-2048", "denial")] },
  // The overview's summary names the missing documents too, so it also answers this.
  { party: "P9", q: "what's missing from my healthcare claim", want: [C("CL-2048", "denial"), C("CL-2048", "overview")] },
  { party: "P9", q: "when is the appeal deadline", want: [C("CL-2048", "denial")] },
  { party: "P9", q: "how long do I have to appeal", want: [C("CL-2048", "denial")] },
  { party: "P12", q: "why was my claim turned down", want: [C("CL-3001", "denial"), C("CL-3001", "overview")] },
  { party: "P12", q: "which report is missing", want: [C("CL-3001", "denial")] },
  { party: "P12", q: "when's my appeal due", want: [C("CL-3001", "denial")] },

  // Status, by type, date, or status words
  { party: "P9", q: "what's the status of my car claim", want: [C("CL-2102", "overview")] },
  { party: "P9", q: "is my vehicle claim still pending", want: [C("CL-2102", "overview")] },
  { party: "P9", q: "which of my claims are still open", want: [C("CL-2102", "overview")] },
  { party: "P9", q: "was my dental claim paid", want: [C("CL-1899", "overview"), C("CL-1899", "amounts")] },
  { party: "P9", q: "what happened with my claim from January 2025", want: [C("CL-2011", "overview")] },
  { party: "P9", q: "the claim I filed in November", want: [C("CL-1899", "overview")] },
  { party: "P9", q: "my claim from February", want: [C("CL-2102", "overview")] },
  { party: "P9", q: "did my old medical claim get settled", want: [C("CL-2011", "overview"), C("CL-2011", "amounts")] },

  // Money
  { party: "P9", q: "how much will I get for my auto claim", want: [C("CL-2102", "amounts")] },
  { party: "P9", q: "how much did you pay for my dental work", want: [C("CL-1899", "amounts")] },
  { party: "P9", q: "how much was paid on the settled healthcare claim", want: [C("CL-2011", "amounts")] },
  { party: "P12", q: "how much would the plan cover", want: [C("CL-3001", "amounts"), "glossary:allowed_max_amount"] },

  // Glossary
  { party: "P9", q: "what does allowed max amount mean", want: ["glossary:allowed_max_amount"] },
  { party: "P9", q: "what's the difference between net pay and net fee", want: ["glossary:net_pay", "glossary:net_fee"] },
  { party: "P9", q: "what is expected reimbursement", want: ["glossary:expected_reimbursement_amount"] },
  { party: "P9", q: "what's the most the insurer will pay", want: ["glossary:allowed_max_amount"] },

  // Document guidance and alternatives
  { party: "P9", q: "I lost the pathology report, what now", want: ["guide:alternative:original pathology report"] },
  { party: "P9", q: "my doctor won't give me the office note", want: ["guide:alternative:treating provider office note"] },
  { party: "P9", q: "what should the office note include", want: ["guide:document:treating provider office note"] },
  { party: "P9", q: "what does the pathology report need to show", want: ["guide:document:original pathology report"] },
  { party: "P9", q: "I don't have photos of the accident", want: ["guide:alternative:supplemental accident scene photos"] },
  { party: "P9", q: "what if I can't get a repair estimate", want: ["guide:alternative:repair estimate"] },
  { party: "P9", q: "what should the repair quote list", want: ["guide:document:repair estimate"] },
  {
    party: "P9",
    q: "what if I can't get any of the documents at all",
    want: ["guide:setting:human_review_after_document_alternatives_exhausted", "guide:followup:missing_required_material_alternatives", "guide:alternative:default"],
  },

  // Submission process
  { party: "P9", q: "how do I upload the documents", want: ["guide:followup:submission_method", "guide:how-to-submit"] },
  { party: "P9", q: "can I fax or mail them instead", want: ["guide:how-to-submit"] },
  { party: "P9", q: "what file format should the scan be", want: ["guide:followup:file_format_requirements"] },
  { party: "P9", q: "will I get a confirmation once you receive them", want: ["guide:followup:receipt_confirmation"] },
  {
    party: "P9",
    q: "how long does the review take after I submit",
    want: ["guide:followup:processing_time_after_submission", "guide:setting:average_processing_time_after_submission"],
  },
  // Both the general timing rule and this caller's appeal deadline answer it.
  { party: "P9", q: "when do I need to send the documents by", want: ["guide:followup:submission_timing", C("CL-2048", "denial")] },
];

/**
 * Held-out set: written after tuning on EVAL_SET and never used to tune, so
 * its score is the honest estimate for new phrasings.
 */
export const HELD_OUT: EvalCase[] = [
  { party: "P9", q: "which policy am I on", want: ["account:P9"] },
  { party: "P9", q: "tell me the reason my claim got declined", want: [C("CL-2048", "denial"), C("CL-2048", "overview")] },
  { party: "P9", q: "is there a deadline to fight the denial", want: [C("CL-2048", "denial")] },
  { party: "P9", q: "what paperwork are you waiting on", want: [C("CL-2048", "denial")] },
  { party: "P9", q: "any update on the accident claim", want: [C("CL-2102", "overview")] },
  { party: "P9", q: "what's the payout on my teeth cleaning claim", want: [C("CL-1899", "amounts")] },
  { party: "P9", q: "how much is the car repair claim worth", want: [C("CL-2102", "amounts")] },
  { party: "P9", q: "did you finish processing my hospital claim from last year", want: [C("CL-2011", "overview"), C("CL-2011", "amounts")] },
  { party: "P9", q: "what does net pay mean on my statement", want: ["glossary:net_pay"] },
  { party: "P9", q: "explain the allowed amount", want: ["glossary:allowed_max_amount"] },
  { party: "P9", q: "the lab never sent me the pathology report", want: ["guide:alternative:original pathology report"] },
  { party: "P9", q: "is a photo of the office note ok or do you need a pdf", want: ["guide:followup:file_format_requirements", "guide:document:treating provider office note"] },
  { party: "P9", q: "where do I send the files", want: ["guide:followup:submission_method", "guide:how-to-submit"] },
  { party: "P9", q: "how will I know you got my documents", want: ["guide:followup:receipt_confirmation"] },
  { party: "P9", q: "once I send everything how long until a decision", want: ["guide:followup:processing_time_after_submission", "guide:setting:average_processing_time_after_submission"] },
  { party: "P9", q: "the body shop hasn't given me an estimate yet", want: ["guide:alternative:repair estimate"] },
  { party: "P9", q: "I never took pictures at the scene", want: ["guide:alternative:supplemental accident scene photos"] },
  { party: "P12", q: "what do I still need to provide", want: [C("CL-3001", "denial")] },
  { party: "P12", q: "how many days do I have left to appeal", want: [C("CL-3001", "denial")] },
  { party: "P12", q: "what's the max my plan pays for this claim", want: [C("CL-3001", "amounts"), "glossary:allowed_max_amount"] },
];
