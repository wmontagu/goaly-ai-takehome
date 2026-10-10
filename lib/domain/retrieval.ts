/**
 * Retrieval over the fixture data: every file is cut into small, labelled
 * chunks, and each turn after verification the caller's question is ranked
 * against them with BM25. The top chunks go into the reply's PHASE_DATA, so
 * the reply answers from the matching records instead of guessing.
 *
 * Scope comes before ranking. Each chunk has an owner: a party_id for that
 * person's account and claims, or "public" for shared guidance. A search only
 * ever sees the verified caller's own chunks plus public ones, so a good text
 * match on someone else's claim can never be retrieved. Nothing here knows
 * any particular ID, name, or value: chunks are generated from whatever the
 * data files contain.
 *
 * Quality (measured by tests/unit/retrieval-eval.test.ts) comes from three
 * things BM25 can't do alone: synonyms callers use for the data's words
 * ("rejected" for denied, "car" for auto), dates written in words, and
 * per-kind keywords saying what question a chunk answers. Keywords are
 * searched but never shown to the reply model.
 */
import { claimFieldGlossary, claims, guideline, policyholders, type Claim } from "@/apps/insurance_claims/data";

export type Chunk = {
  /** Stable, human-readable label shown in the trace, e.g. "claim:<case_id>:amounts". */
  id: string;
  owner: string | "public";
  /** The facts, as the reply model sees them. */
  text: string;
  /** Extra search terms: what kind of question this chunk answers. Not shown to the model. */
  keywords?: string;
};

export type Retrieved = { id: string; score: number; text: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-01-12" → "January 12, 2026", so "my claim from January" can match. */
function dateInWords(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${d}, ${y}` : iso;
}

function claimChunks(c: Claim): Chunk[] {
  const base = `Claim ${c.case_id} (${c.case_type})`;
  const filed = `filed ${dateInWords(c.created_at)}`;
  const chunks: Chunk[] = [
    {
      id: `claim:${c.case_id}:overview`,
      owner: c.party_id,
      text: `${base}: ${filed}, status ${c.status}. ${c.summary}.`,
      keywords: "status update what happened progress my claims list",
    },
    {
      id: `claim:${c.case_id}:amounts`,
      owner: c.party_id,
      text: `${base}, status ${c.status}, amounts: expected reimbursement ${c.expected_reimbursement_amount}, allowed max amount ${c.allowed_max_amount}, net pay ${c.net_pay}, net fee ${c.net_fee}.`,
      keywords: "how much money payment pay paid get receive cover reimburse dollars",
    },
  ];
  if (c.denial_reason || c.documents_needed?.length || c.appeal_deadline) {
    chunks.push({
      id: `claim:${c.case_id}:denial`,
      owner: c.party_id,
      text: [
        `${base} denial:`,
        c.denial_reason ? `denied because ${c.denial_reason}.` : "",
        c.documents_needed?.length ? `Documents needed: ${c.documents_needed.join(", ")}.` : "",
        c.appeal_deadline ? `Appeal deadline ${dateInWords(c.appeal_deadline)}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      keywords: "why reason missing documents need send appeal deadline how long time left",
    });
  }
  return chunks;
}

/**
 * Guide entries are templates ("For claim {case_id}, please submit
 * {documents}..."). Placeholders aren't words a caller says, so they're
 * replaced with plain phrasing before indexing; the engine fills in the real
 * values for the selected claim elsewhere.
 */
function fillTemplate(text: string): string {
  return text.replace(/\{case_id\}/g, "your claim").replace(/\{documents\}/g, "the requested items").replace(/\{\w+\}/g, "");
}

/** Every chunk in the knowledge base, built once from the data files. */
export function buildChunks(): Chunk[] {
  const chunks: Chunk[] = [];
  for (const p of policyholders) {
    // Account basics only: never DOB, ID digits, or full contact details.
    chunks.push({
      id: `account:${p.party_id}`,
      owner: p.party_id,
      text: `Account holder ${p.name}. Policy number ${p.policy_number}.`,
      keywords: "my policy number account name policyholder",
    });
  }
  for (const c of claims) chunks.push(...claimChunks(c));

  for (const [field, { description }] of Object.entries(claimFieldGlossary)) {
    chunks.push({
      id: `glossary:${field}`,
      owner: "public",
      text: `${field.replace(/_/g, " ")}: ${description}`,
      keywords: "what does mean meaning definition difference explain term",
    });
  }
  chunks.push({
    id: "guide:how-to-submit",
    owner: "public",
    text: `How to submit documents: ${guideline.default_guidance.en}`,
    keywords: "how submit upload send fax mail portal",
  });
  for (const [type, t] of Object.entries(guideline.case_type_guidance)) {
    chunks.push({ id: `guide:case-type:${type}`, owner: "public", text: `Submitting documents for ${type} claims: ${t.en}` });
  }
  for (const [doc, t] of Object.entries(guideline.document_guidance)) {
    chunks.push({
      id: `guide:document:${doc}`,
      owner: "public",
      text: `What a good ${doc} includes: ${t.en}`,
      keywords: "what should include show contain need requirements",
    });
  }
  for (const [doc, t] of Object.entries(guideline.document_alternative_guidance)) {
    const what = doc === "default" ? "a requested document" : `the ${doc}`;
    chunks.push({
      id: `guide:alternative:${doc}`,
      owner: "public",
      text: `If you don't have ${what}: ${t.en}`,
      keywords: `lost missing don't have can't get won't give unavailable alternative substitute what now${doc === "default" ? " any documents none at all" : ""}`,
    });
  }
  for (const [key, t] of Object.entries(guideline.claim_followup_settings)) {
    chunks.push({ id: `guide:setting:${key}`, owner: "public", text: `${key.replace(/_/g, " ")}: ${fillTemplate(t.en)}` });
  }
  for (const f of guideline.claim_followup_guidance) {
    chunks.push({
      id: `guide:followup:${f.topic}`,
      owner: "public",
      text: `${f.topic.replace(/_/g, " ")}: ${fillTemplate(f.en)}`,
      // The data's own trigger phrases are the best keywords for each topic.
      keywords: (f.match_any ?? []).join(" "),
    });
  }
  return chunks;
}

// --- Tokens ------------------------------------------------------------------

const STOPWORDS = new Set(
  "a an and are as at be but by can could did do does for from had has have i if in is it its me my of on or our so that the their them then there this to was we what when where which who why will with you your".split(
    " ",
  ),
);

/**
 * Words callers use → the data's word, applied to queries and chunks alike.
 * Domain vocabulary for claims in general, not values from this data set.
 */
const SYNONYMS: Record<string, string> = {
  rejected: "denied", reject: "denied", refused: "denied", declined: "denied", turned: "denied", denial: "denied", deny: "denied",
  car: "auto", vehicle: "auto", accident: "auto",
  medical: "healthcare", health: "healthcare", hospital: "healthcare", doctor: "healthcare",
  teeth: "dental", dentist: "dental",
  pending: "open", progress: "open",
  settled: "closed", completed: "closed", finished: "closed", done: "closed",
  most: "max", maximum: "max",
  quote: "estimate",
  cannot: "cant", unable: "cant",
  confirmation: "confirm", confirmed: "confirm", received: "receive", receipt: "receive",
  due: "deadline",
  reimbursement: "reimburse",
  filed: "file", submitted: "submit", upload: "submit", uploading: "submit",
  photos: "photo", pictures: "photo", picture: "photo",
};

/** A small, consistent suffix stripper, so "includes"/"included"/"include" agree. */
function stem(t: string): string {
  if (t.length <= 3 || /\d/.test(t)) return t;
  let s = t;
  if (/ies$/.test(s) || /ied$/.test(s)) s = s.slice(0, -3) + "y";
  else if (/ing$/.test(s) && s.length > 5) s = s.slice(0, -3);
  else if (/ed$/.test(s) && s.length > 4) s = s.slice(0, -2);
  else if (/(ss|us)$/.test(s)) s = s;
  else if (/(s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (/s$/.test(s)) s = s.slice(0, -1);
  return s.length > 3 ? s.replace(/e$/, "") : s;
}

/** Lowercase word tokens: stopwords dropped, synonyms mapped, then stemmed. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().replace(/'/g, "").match(/[a-z0-9]+/g) ?? [])
    .filter((t) => !STOPWORDS.has(t))
    .map((t) => stem(SYNONYMS[t] ?? t));
}

// --- BM25 --------------------------------------------------------------------

const K1 = 1.2;
const B = 0.75;

type Indexed = { chunk: Chunk; terms: Map<string, number>; length: number };

function index(chunks: Chunk[]): Indexed[] {
  return chunks.map((chunk) => {
    const tokens = tokenize(`${chunk.text} ${chunk.keywords ?? ""}`);
    const terms = new Map<string, number>();
    for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
    return { chunk, terms, length: tokens.length };
  });
}

const ALL = index(buildChunks());

/**
 * Ranks the caller-visible chunks against `query` and returns the best `k`
 * with a positive score. `ownerId` is the verified party; chunks owned by
 * anyone else are removed before scoring, so they never compete.
 */
export function retrieve(query: string, ownerId: string, k = 5): Retrieved[] {
  const docs = ALL.filter((d) => d.chunk.owner === "public" || d.chunk.owner === ownerId);
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length || !docs.length) return [];

  const avgLength = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const df = new Map<string, number>();
  for (const t of qTerms) df.set(t, docs.filter((d) => d.terms.has(t)).length);

  return docs
    .map((d) => {
      let score = 0;
      for (const t of qTerms) {
        const tf = d.terms.get(t) ?? 0;
        if (!tf) continue;
        const n = df.get(t)!;
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
        score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / avgLength));
      }
      return { id: d.chunk.id, score: Math.round(score * 100) / 100, text: d.chunk.text };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
