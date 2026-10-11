# SOP-Guided Insurance Claims Agent

An insurance claims support agent that follows a fixed 4-phase SOP,
`VERIFY_ID → RESOLVE_INTENT → PROCESS_CASE → POST_PROCESS`, while still
conversing naturally, by text or by voice.

**Code owns the state machine. The LLM owns language.** The model never
decides that a caller is verified or that the conversation moves on. It
proposes structured facts, and deterministic code checks them against the
data, decides the phase, and controls which data the reply is allowed to see.

- **Live demo:** https://goaly-ai-takehome.onrender.com/
- **Design walkthrough (video), why it's built this way:** https://drive.google.com/file/d/1mLmagkvi1eBDVVJffMnM_GRTgrwL_fct/view?usp=drivesdk
- **Demo walkthrough (video):** https://drive.google.com/file/d/1dleTMvqmXGySmnxF2y5Cw7lKiv5yex9b/view?usp=sharing
- **Design contract:** [SPEC.md](./SPEC.md)

> **About this write-up.** I built this with Claude Code as my pair
> programmer, and this README was drafted with AI. The design decisions and
> trade-offs described below are mine; the [Design decisions](#design-decisions)
> section explains each one and why I made it, and the design walkthrough
> video above covers them in my own words.

## Review it in 3 minutes

The live demo runs on my API key, so there's nothing to set up. To use your
own, paste it into the test drawer and click **Use key**: it's checked with
Anthropic first, then used for your tab only. It's sent per request and never
stored on the server.

**1. Click a script.** The **Scripts** row in the test drawer fills in each
caller line. Press Send to use it, or type your own.

| Script | What to watch for |
| --- | --- |
| **Margaret: happy path** | The full SOP. One message verifies her and goes straight to her denied January claim (CL-2048) without asking "how can I help?" It explains the denial from the claim record, then offers an email summary when she's done. |
| **Hint before verification** | She mentions the claim first, then gives ID one detail at a time. The agent says nothing about any claim until she's verified, and then uses the remembered hint instead of asking which claim. |
| **Frustrated caller** | "This is ridiculous. Just tell me why my claim was denied." The agent acknowledges the frustration and explains why verification is required, but doesn't skip it. |

Also worth a click: **Injection attempt** (the reply is blocked before it
reaches you), **Off-topic ×3** (refuse, offer a human, then transfer), and
**Rep David Chen** (a son calling for his mother, which needs her consent).

**2. Watch the side panels.** **SOP state** shows the phase, which identity
fields matched, what the agent remembered, and the escalation counters.
**Trace** shows every pipeline step of every turn: what the model understood,
what code decided, which records retrieval pulled (with BM25 scores), and
whether the output filter blocked anything. Both can be hidden from the
header to just talk to the agent.

**3. Try your own.** Verifying takes any 3 matching details from one person.

| Person | Policy | Date of birth | ID last 4 | Phone | Claims |
| --- | --- | --- | --- | --- | --- |
| Margaret Chen | POL-9921 | 1985-03-15 | SSN 4472 | 650-521-2836 | CL-2048 healthcare, denied · CL-2102 auto, open · 2 closed |
| Ma Tian | POL-8836 | 1964-09-10 | national ID 6688 | 650-208-8799 | CL-3001 healthcare, denied |
| Ava Lopez | POL-1044 | 1990-08-21 | SSN 9180 | 650-388-2920 | none |

David Chen (her son) can call on Margaret's behalf. Everything is in
[`apps/insurance_claims/fixtures/`](./apps/insurance_claims/fixtures/).

Things to try: give two people's details mixed together (the agent asks you
to repeat them without saying which one is wrong), ask about "my car claim"
after verifying as Margaret, or ask to speak to a person at any point.

**4. Make it a phone call.** Turn on **📞 Call mode** in the header and allow
the microphone. The agent reads its replies aloud, then listens: your words
appear in the message box as you speak and send when you pause (or tap
**Done**). **Talk** interrupts the agent mid-sentence.

**5. Get transferred.** Ask for a person, or go off-topic three times. The
human agent gets a **handoff note**: who's calling, whether they're verified,
what they need, how they're feeling, and what was already tried, so the
caller doesn't start over.

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind CSS 4**
- **Anthropic API** (`@anthropic-ai/sdk`), two models per turn:
  - **Claude Haiku** (`claude-haiku-5-5`): the structured "understand" call
  - **Claude Sonnet** (`claude-sonnet-5-5`): the reply and the email summary
- **Zod** structured outputs for every model call that returns data
- **BM25 retrieval** over chunked fixture data, written in TypeScript (no search library)
- **Deepgram** (`nova-3`) speech-to-text for Call mode, called from the server
- **Web Speech API** (`speechSynthesis`) for the agent's voice
- **Server-Sent Events** (native `ReadableStream`) to stream the pipeline trace live
- **Vitest** unit tests (no LLM) plus a golden-conversation eval against the real models
- **Render** (one Node web service) for hosting, plus a **Dockerfile**

## Setup

Requirements: **Node.js 22+** and npm. Dependencies are not included in the
submission; `npm install` fetches them.

```bash
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local
# edit .env.local: set ANTHROPIC_API_KEY (and DEEPGRAM_API_KEY for voice)
npm run dev
```

Open http://localhost:3000. With no server key, paste one into the test
drawer and click **Use key** instead.

### Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes (or pasted in the UI) | none | Model access |
| `DEEPGRAM_API_KEY` | for voice | none | Call mode speech-to-text. Without it, Call mode falls back to the browser's own recognition (Chrome/Edge only) |
| `SOP_TODAY` | recommended | real date | Fixed "today" (YYYY-MM-DD) for deadline math. Use `2026-03-01`: it's after every claim was filed and before both appeal deadlines |
| `MODEL_UNDERSTAND` | no | `claude-haiku-5-5` | The understand call |
| `MODEL_RESPOND` | no | `claude-sonnet-5-5` | The reply and email summary |
| `ANTHROPIC_WORKSPACE_ID` | no | none | Only for a server key that isn't scoped to a workspace |
| `EMAIL_PROVIDER` | no | `simulated` | Email sender implementation |

### Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build   # the full gate (94 unit tests)
npm run eval                                                     # golden conversations against the real models (reads .env.local / .env)
npm run eval -- margaret                                         # just the ones whose name contains "margaret"
```

### Docker

```bash
docker build -t sop-agent .
docker run -e ANTHROPIC_API_KEY=sk-ant-... -e DEEPGRAM_API_KEY=... -e SOP_TODAY=2026-03-01 -p 3000:3000 sop-agent
```

### Deploy (Render)

[`render.yaml`](./render.yaml) is a blueprint for one web service: build
`npm install && npm run build`, start `npx next start -p $PORT`, health check
`/api/health` (which also reports whether the keys are configured, never the
keys themselves). Set `ANTHROPIC_API_KEY` and `DEEPGRAM_API_KEY` as secrets
in the dashboard. Keep it at **one instance**: SOP state lives in that
process's memory.

## Design decisions

These are the choices I made, and why.

**1. Code owns the state machine; the model only handles language.**
Each turn makes two model calls. Haiku turns the caller's message into
structured facts (identity details, intent, which claim, emotion), and
Sonnet writes the reply. Everything in between is ordinary code: merging
facts into memory, checking the current phase's exit condition, moving to
the next phase, and choosing which data the reply may see. The model can't
verify anyone, skip a step, or reach claim data early, because none of
those are its decisions. I chose this over a single agent with tools
because an SOP is exactly the kind of rule a model will eventually bend
under a persuasive caller.

**2. Verification is an exact match, not a search.** Any 3 of name, date of
birth, phone, email, ID last 4, or policy number must match one record, with
no contradictions. I deliberately didn't use fuzzy or ranked matching here:
a "closest person" is the wrong answer for identity. When something doesn't
match, the agent asks for the full name again plus the other details given,
always the same way, so the caller can correct a typo (or a mis-transcribed
word) without the agent ever revealing which detail was wrong or reading a
value back.

**3. Facts are remembered in any phase.** If a caller says "my denied claim
from January" before verifying, it's stored and used the moment they're
verified, instead of asking again. The agent never confirms the claim exists
until then.

**4. Retrieval: BM25, scoped by owner, top 5.** After verification, the data
files are searched for what the caller just asked. Every file is cut into
small labelled chunks (an account, each claim's overview / denial / amounts,
each glossary term, each document guide), and each chunk is owned by one
person or is public guidance. The search only ever sees the verified
caller's chunks plus public ones, so someone else's claim can't be
retrieved however well it matches; access control comes before ranking. The
top 5 go to the reply. I measured it on a labelled question set: 98% of
questions rank the right record first on the set I tuned with, and on 20
held-out questions I never tuned on, the right record reaches the reply
(top 5) 95% of the time. The misses are vocabulary gaps ("paperwork" for
documents), which is what embeddings fix. For a production knowledge base I'd
move to hybrid BM25 + embeddings; for ~50 chunks, BM25 is simpler, free, and
explainable.

**5. Every reply is checked before the caller sees it.** Before
verification, a reply mentioning any claim or policyholder detail the caller
didn't type is replaced. After verification, dollar amounts, dates, and
reference numbers in the reply must come from the data it was given, or the
reply is regenerated once. Retrieval decides what goes in; this checks what
comes out.

**6. Voice is just another way of typing.** In Call mode, the caller's audio
is transcribed by Deepgram on the server (the key never reaches the
browser), and the transcript goes through exactly the same pipeline as a
typed message, so every SOP rule still applies to speech. I chose separate
speech-to-text over a speech-to-speech model for that reason: a realtime
voice model would answer before any of the checks ran. The caller's words
appear live as they talk, and the turn ends on a pause that's longer
mid-sentence (3s) than after a finished one (1.8s).

**7. The handoff note is built by code, not the model.** On transfer, the
human agent gets who's calling, verification status, the need, the claim,
mood, and what was already tried. Building it from the SOP's memory means it
costs nothing, can't invent anything, and contains no claim data for an
unverified caller.

**8. Escalation counters don't reset each other.** Off-topic requests,
failed verification attempts, and refusals each have their own counter
(offer a human at 2, transfer at 3). An on-topic turn resets the off-topic
count, but not if that same turn broke a different rule.

**9. The email stays simulated.** The summary is generated and shown as an
email card, but not sent. Every address in the data is fictional, and the
rule that a summary only goes to the email on file (so nobody can redirect
someone else's claim details to their own inbox) matters more than a real
send. A real provider is one class behind the `EmailSender` interface.

**10. One server, state in memory.** All SOP state lives on the server; the
browser holds only a session ID, so it can't forge verification or reset a
counter. One Render instance keeps that simple. Scaling out would need a
shared store (e.g. Redis) behind the session store.

## How it works

### One fixed pipeline per turn ([`lib/sop/engine.ts`](./lib/sop/engine.ts))

```
① UNDERSTAND  Haiku → typed Understanding (Zod). Never sees the data.
② REMEMBER    merge into SessionMemory, in every phase
   POLICIES   human request → transfer; off-topic/injection → strike, no gate
③ GATES       current phase's exit condition, against memory + data
④ TRANSITION  pass → next phase, and re-run the next gate (cascade)
   RETRIEVE   post-verify only: BM25 over the caller's own chunks + guidance
⑤ RESPOND     Sonnet, given only this phase's data + directives
⑥ FILTER      pre-verify: block leaks; post-verify: ground amounts, dates, IDs
```

### Gates are loops ([`lib/sop/gates.ts`](./lib/sop/gates.ts))

Each phase repeats across turns until its exit condition holds, and returns
exactly what's missing so the reply asks for that. Within one turn, gates
that memory already satisfies cascade, which is how Margaret's first message
goes VERIFY_ID → RESOLVE_INTENT → PROCESS_CASE. Every loop has a capped
escape to a human.

| Phase | Exit condition | Escape |
| --- | --- | --- |
| VERIFY_ID | any 3 identity fields match one record, no contradictions (+ rep consent) | 3 failed attempts · consent timeout |
| RESOLVE_INTENT | an intent + one of the verified caller's claims | offers a human after 3 turns with no progress |
| PROCESS_CASE | the caller says they're done | off-topic strikes · human request |
| POST_PROCESS | explicit email yes / no | 2 unclear answers → skip |

### Defense in depth against leaks

1. **Context isolation:** before verification, the reply prompt contains no
   claim data at all ([`phases.ts`](./lib/sop/phases.ts)).
2. **Per-phase tool allowlist:** claim lookups can't run in VERIFY_ID, and
   rejected calls are logged ([`tools.ts`](./lib/tools.ts)).
3. **Scoped retrieval:** the search can only see the verified caller's own
   records ([`retrieval.ts`](./lib/domain/retrieval.ts)).
4. **Output filter:** checks every reply before the caller sees it
   ([`filter.ts`](./lib/sop/filter.ts)).
5. **Transitions are code-only:** the model has no way to change the phase.

### Emotion and SOP recovery

The understand call labels emotion. Code maps that label to a fixed strategy
injected into the reply prompt: acknowledge the feeling, explain why the
step exists (fixed text per gate), offer alternatives (other ID fields, or a
human), and end with one concrete next step. The gate itself never relaxes.

## Project structure

```
apps/insurance_claims/   fixtures (given, untouched), typed loader, SOP config, prompts
lib/sop/                 engine, state machine, gates, memory, policies, phases, filter, directives, handoff
lib/domain/              identity matching, retrieval (BM25), case resolution, guidance, email summary
lib/llm/                 Anthropic client, understand (Haiku), respond + summarize (Sonnet)
lib/email/               EmailSender interface + simulated sender
lib/tools.ts             agent actions behind the per-phase allowlist
app/                     UI (chat, Call mode, SOP state, trace, test drawer)
app/api/                 /chat (SSE), /session, /transcribe (Deepgram), /key-check, /health
tests/unit/              94 Vitest tests, no LLM (engine via a scripted LLM, retrieval eval set)
tests/golden/            real-model conversation evals
```

## Known limitations

- **Replies aren't token-streamed.** Each reply is generated in full, checked
  by the output filter, then sent; streaming would show a leaking reply
  before the filter could block it. The pipeline trace does stream live.
- **Retrieval is keyword-based.** It misses questions that share no words
  with the data ("paperwork" for documents); embeddings would close that gap.
- **The agent's voice is the browser's built-in one**, so it varies by
  device and can sound robotic. A cloud text-to-speech service would fix it.
- **The output filter is pattern-based.** A model paraphrasing a denial
  reason in entirely new words would get past it. Context isolation is what
  prevents that: before verification the model has no claim data to
  paraphrase.
- **Sessions live in memory** in one process; a restart wipes them.
- **No auth on the demo UI.** The identity checklist in the state panel shows
  which fields matched. That's useful for reviewers, but a real deployment
  would hide it from callers.
