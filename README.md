# SOP-Guided Insurance Claims Agent

An insurance claims support agent that follows a fixed 4-phase SOP,
`VERIFY_ID → RESOLVE_INTENT → PROCESS_CASE → POST_PROCESS`, while still
conversing naturally.

**Code owns the state machine. The LLM owns language.** The model never
decides that a caller is verified or that the conversation moves on. It
proposes structured facts, and deterministic code checks them against the
fixtures, decides the phase, and controls which data the reply is allowed to
see.

The full design contract is [SPEC.md](./SPEC.md).

## Review it in 3 minutes

**Live demo: https://goaly-ai-takehome.onrender.com/**

It runs on my API key, so there's nothing to set up. To use your own, paste
it into the **API key** field in the test drawer. It stays in your browser
tab, is sent per request, and is never stored on the server.

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
what code decided, and whether the output filter blocked anything. Both can
be hidden from the header to just talk to the agent.

**3. Try your own.** Verifying takes any 3 matching details from one person.

| Person | Policy | Date of birth | ID last 4 | Phone | Claims |
| --- | --- | --- | --- | --- | --- |
| Margaret Chen | POL-9921 | 1985-03-15 | SSN 4472 | 650-521-2836 | CL-2048 healthcare, denied · CL-2102 auto, open · 2 closed |
| Ma Tian | POL-8836 | 1964-09-10 | national ID 6688 | 650-208-8799 | CL-3001 healthcare, denied |
| Ava Lopez | POL-1044 | 1990-08-21 | SSN 9180 | 650-388-2920 | none |

David Chen (her son) can call on Margaret's behalf. Everything is in
[`apps/insurance_claims/fixtures/`](./apps/insurance_claims/fixtures/).

Things to try: give two people's details mixed together (the agent won't
say which one is wrong), ask about "my car claim" after verifying as
Margaret, or ask to speak to a person at any point.

**4. Make it a phone call.** Turn on **📞 Call mode** in the header. The
agent reads its replies aloud, then listens for your answer and sends it when
you pause; the mic button talks, interrupts, or sends right away. Your speech
is transcribed by Deepgram on the server, so it works in any modern browser;
the voice is the browser's own. It only ever speaks the reply that already
passed the output filter.

**5. Get transferred.** Ask for a person, or go off-topic three times. The
human agent gets a **handoff note**: who's calling, whether they're verified,
what they need, how they're feeling, and what was already tried, so the
caller doesn't start over. Code builds it from the SOP's memory, not the
model, and it contains no claim data unless the caller was verified.

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind 4**
- **Anthropic SDK** with two models per turn:
  - **Haiku** (`claude-haiku-5-5`) for the cheap, structured "understand" call
  - **Sonnet** (`claude-sonnet-5-5`) for the reply and the email summary, with server-side refusal fallbacks
- **Zod** structured outputs for every model call that returns data
- **SSE** (native `ReadableStream`) to stream each turn's pipeline trace to the UI
- **Vitest** for unit tests (no LLM), plus a golden-conversation eval runner against the real models
- **Render** as one persistent Node service, with a **Dockerfile** for the Docker deliverable

## Setup (local)

```bash
npm install
cp .env.example .env.local
# set ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. If the server has no key, paste one into the
**test drawer**. That key is held in that browser tab only, sent per request
in a header, and never stored or logged on the server.

### Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes (or supplied via the UI) | none | Model access |
| `ANTHROPIC_WORKSPACE_ID` | no | none | Only for a server key that isn't scoped to a workspace (Anthropic then requires a workspace ID per request) |
| `MODEL_UNDERSTAND` | no | `claude-haiku-5-5` | Call ①: classify + extract |
| `MODEL_RESPOND` | no | `claude-sonnet-5-5` | Call ⑤: reply, plus the email summary |
| `DEEPGRAM_API_KEY` | no | none | Call mode speech-to-text. Without it, Call mode uses the browser's own recognition (Chrome/Edge only) |
| `EMAIL_PROVIDER` | no | `simulated` | Email sender implementation |
| `SOP_TODAY` | no | real date | Fixed "today" (YYYY-MM-DD) for deadline math. `2026-03-01` fits every fixture: after all claims were created and before both appeal deadlines. |

### Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build   # the full gate
npm run eval                                                     # golden conversations, real models (key from .env)
npm run eval -- margaret                                         # just one
```

## Docker

```bash
docker build -t sop-agent .
docker run -e ANTHROPIC_API_KEY=sk-... -e SOP_TODAY=2026-03-01 -p 3000:3000 sop-agent
```

## Deploy (Render)

`render.yaml` is a blueprint for one web service:
- Build `npm install && npm run build`, start `npx next start -p $PORT`.
- Set `ANTHROPIC_API_KEY` as a secret in the dashboard (`sync: false`).
- **1 instance, no autoscaling.** All SOP state is server-side in that
  process's memory, so a second instance would split sessions.
- Health check: `/api/health`.
- The blueprint uses the Starter plan. The free plan sleeps after about 15
  minutes idle and wipes open sessions. If that happens the UI says so and
  starts a fresh session, which always begins at VERIFY_ID.

## Try it

Pick **Margaret: happy path** in the test drawer, or send:

> I'm the policyholder. My name is Margaret Chen, policy POL-9921. I'm
> calling about my denied healthcare claim from January. DOB is 1985-03-15,
> SSN last four is 4472.

That one message verifies her, resolves claim CL-2048 from the hint she gave
(without asking "how can I help?"), and explains the denial from the claim
record. Say you're done, and the agent offers an email summary that you can
accept or skip. The middle panel shows the phase, identity checklist, memory,
and counters. The right panel shows every pipeline step.

Other scripts in the drawer: hint before verification, frustrated caller,
refuses SSN, off-topic ×3, representative David Chen (consent approved or
timing out), Ma Tian (national ID), and an injection attempt.

## How it works

### One fixed pipeline per turn ([`lib/sop/engine.ts`](./lib/sop/engine.ts))

```
① UNDERSTAND  Haiku → typed Understanding (Zod). Never sees fixture data.
② REMEMBER    merge into SessionMemory, in every phase
   POLICIES   human request → transfer; off-topic/injection → strike, no gate
③ GATES       current phase's exit condition, against memory + fixtures
④ TRANSITION  pass → next phase, and re-run the next gate (cascade)
   RETRIEVE    post-verify only: BM25 over chunked fixtures, scoped to the
              caller's own records + shared guidance (lib/domain/retrieval.ts)
⑤ RESPOND     Sonnet, given only this phase's visibleData() + directives
⑥ FILTER      pre-verify: block claim/PII leaks; post-verify: ground amounts,
              dates, and reference numbers (formats learned from the data)
```

### Gates are loops ([`lib/sop/gates.ts`](./lib/sop/gates.ts))

Each phase repeats across turns until its exit condition holds, and returns
exactly what's missing so the reply asks for that. Within one turn, gates
that memory already satisfies cascade. That's how Margaret's first message
goes VERIFY_ID → RESOLVE_INTENT → PROCESS_CASE. Every loop also has a capped
escape to a human, so none can run forever.

| Phase | Exit condition | Escape |
| --- | --- | --- |
| VERIFY_ID | any 3 of {name, DOB, phone, email, ID last 4, policy number} match one record, with no contradictions (+ rep consent) | 3 failed attempts · consent timeout |
| RESOLVE_INTENT | an intent + one of the verified caller's claims | offers a human after 3 turns with no progress |
| PROCESS_CASE | the caller says they're done | off-topic strikes · human request |
| POST_PROCESS | explicit email yes / no | 2 unclear answers → skip |

**Verification decisions.**
- **The policy number counts as one of the 3 fields**, and it's also the
  lookup key. One caveat: name and policy number are both printed on an
  insurance card, so a stolen card gives 2 of 3, and the third field has to
  be something that isn't on the card.
- **A failed attempt** is any of: a contradicting field, a re-ask answered
  with no new matching field, or a refusal. The first ask is free, and
  clarifying questions don't count.
- **The reply never learns which field was wrong.** The model only gets how
  many fields were *provided*.

### Defense in depth against leaks (SPEC §7)

1. **Context isolation**: before verification, the reply prompt contains no
   claim data at all ([`phases.ts`](./lib/sop/phases.ts)).
2. **Per-phase tool allowlist**: claim lookups can't run in VERIFY_ID, and
   rejected calls are logged ([`tools.ts`](./lib/tools.ts)).
3. **Output filter**: any reply that mentions fixture values the caller
   didn't type is replaced before the caller sees it ([`filter.ts`](./lib/sop/filter.ts)).
4. **Transitions are code-only**: the model has no way to change the phase.

### Server-side state

The browser holds only a session ID. Phase, memory, counters, consent, the
outbox, and the trace all live in the Render process
([`session-store.ts`](./lib/session-store.ts)), so a client can't forge
verification or reset a counter. The state panel is a read-only view.

### Emotion and SOP recovery

The understand call labels emotion. Code maps that label to a fixed strategy
injected into the reply prompt:
1. acknowledge the feeling;
2. explain why the gate exists (fixed rationale text per gate);
3. offer alternatives (other ID fields, or a human);
4. end with one concrete next step.

The gate itself never relaxes.

## Project structure

```
apps/insurance_claims/   fixtures (given, untouched), typed loader, SOP config, prompts, doc aliases
lib/sop/                 engine, state machine, gates, memory, policies, phases, filter, directives, view
lib/domain/              identity matching, case resolution, guidance, email summary, representatives
lib/llm/                 Anthropic client, understand (Haiku), respond + summarize (Sonnet)
lib/email/               EmailSender interface + simulated sender
lib/tools.ts             agent actions behind the per-phase allowlist
app/                     UI (chat, SOP state, trace, test drawer) + /api/chat, /api/session, /api/health
tests/unit/              vitest, no LLM (61 tests, including the engine with a scripted LLM)
tests/golden/            real-model conversation evals
```

## Known limitations

- **Replies aren't token-streamed.** Each reply is generated in full, checked
  by the output filter, then sent. Streaming tokens live would show a leaking
  reply before the filter could block it. The pipeline trace does stream live.
- **The email is simulated.** It appears as a preview card. A real provider
  is one class behind `EmailSender` plus `EMAIL_PROVIDER`.
- **Sessions live in memory** in one process. A restart wipes them, and
  scaling past one instance would need Render Key Value behind the session store.
- **The output filter is pattern-based.** It reliably catches fixture values,
  case IDs, and dollar amounts, but a model paraphrasing a denial reason in
  entirely new words would get past it. Context isolation is what prevents
  that: before verification the model has no claim data to paraphrase.
- **No auth on the demo UI.** The identity checklist in the state panel shows
  which fields matched. That's useful for reviewers, but a real deployment
  would hide it from callers.
