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
 */
import { claimFieldGlossary, claims, guideline, policyholders, type Claim } from "@/apps/insurance_claims/data";

export type Chunk = {
  /** Stable, human-readable label shown in the trace, e.g. "claim:<case_id>:amounts". */
  id: string;
  owner: string | "public";
  text: string;
};

export type Retrieved = { id: string; score: number; text: string };

/**
 * Everyday words callers use for each claim type, so "my car claim" finds an
 * "auto" claim. Domain vocabulary, not data: it applies to any claim of that type.
 */
const CASE_TYPE_WORDS: Record<string, string> = {
  auto: "car vehicle accident",
  healthcare: "medical health doctor hospital",
  dental: "teeth dentist",
};

function claimChunks(c: Claim): Chunk[] {
  const base = `Claim ${c.case_id} (${c.case_type} ${CASE_TYPE_WORDS[c.case_type] ?? ""})`;
  const chunks: Chunk[] = [
    {
      id: `claim:${c.case_id}:overview`,
      owner: c.party_id,
      text: `${base}: filed ${c.created_at}, status ${c.status}. ${c.summary}.`,
    },
    {
      id: `claim:${c.case_id}:amounts`,
      owner: c.party_id,
      text: `${base} amounts and payment: expected reimbursement ${c.expected_reimbursement_amount}, allowed maximum ${c.allowed_max_amount}, net pay (paid) ${c.net_pay}, net fee ${c.net_fee}.`,
    },
  ];
  if (c.denial_reason || c.documents_needed?.length || c.appeal_deadline) {
    chunks.push({
      id: `claim:${c.case_id}:denial`,
      owner: c.party_id,
      text: [
        `${base} denial and next steps:`,
        c.denial_reason ? `denied because ${c.denial_reason}.` : "",
        c.documents_needed?.length ? `Documents needed: ${c.documents_needed.join(", ")}.` : "",
        c.appeal_deadline ? `Appeal deadline ${c.appeal_deadline}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  return chunks;
}

/** Every chunk in the knowledge base, built once from the data files. */
export function buildChunks(): Chunk[] {
  const chunks: Chunk[] = [];
  for (const p of policyholders) {
    // Account basics only: never DOB, ID digits, or full contact details.
    chunks.push({
      id: `account:${p.party_id}`,
      owner: p.party_id,
      text: `Account holder ${p.name}. Policy number ${p.policy_number}. My policy, policy number, account details.`,
    });
  }
  for (const c of claims) chunks.push(...claimChunks(c));

  for (const [field, { description }] of Object.entries(claimFieldGlossary)) {
    chunks.push({ id: `glossary:${field}`, owner: "public", text: `What ${field.replace(/_/g, " ")} means: ${description}` });
  }
  chunks.push({ id: "guide:how-to-submit", owner: "public", text: `How to submit or upload documents: ${guideline.default_guidance.en}` });
  for (const [type, t] of Object.entries(guideline.case_type_guidance)) {
    chunks.push({ id: `guide:case-type:${type}`, owner: "public", text: `Submitting documents for ${type} claims: ${t.en}` });
  }
  for (const [doc, t] of Object.entries(guideline.document_guidance)) {
    chunks.push({ id: `guide:document:${doc}`, owner: "public", text: `What a good ${doc} includes: ${t.en}` });
  }
  for (const [doc, t] of Object.entries(guideline.document_alternative_guidance)) {
    const what = doc === "default" ? "a requested document" : `the ${doc}`;
    chunks.push({ id: `guide:alternative:${doc}`, owner: "public", text: `If you don't have ${what} or it's missing or unavailable: ${t.en}` });
  }
  for (const [key, t] of Object.entries(guideline.claim_followup_settings)) {
    chunks.push({ id: `guide:setting:${key}`, owner: "public", text: `${key.replace(/_/g, " ")}: ${t.en}` });
  }
  for (const f of guideline.claim_followup_guidance) {
    chunks.push({
      id: `guide:followup:${f.topic}`,
      owner: "public",
      text: `${f.topic.replace(/_/g, " ")}. ${(f.match_any ?? []).join(". ")}. ${f.en}`,
    });
  }
  return chunks;
}

// --- BM25 -----------------------------------------------------------------

const STOPWORDS = new Set(
  "a an and are as at be but by can could did do does for from had has have how i if in is it its me my of on or our so that the their them then there this to was we what when where which who why will with you your".split(
    " ",
  ),
);

/** Lowercase word tokens, minus stopwords, with a light plural/suffix strip. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => !STOPWORDS.has(t))
    .map((t) => (t.length > 4 ? t.replace(/(ing|ed|es|s)$/, "") : t));
}

const K1 = 1.2;
const B = 0.75;

type Indexed = { chunk: Chunk; terms: Map<string, number>; length: number };

function index(chunks: Chunk[]): Indexed[] {
  return chunks.map((chunk) => {
    const tokens = tokenize(chunk.text);
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
