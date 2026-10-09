# SOP-Guided Insurance Claims Agent

An insurance claims support agent that follows a fixed 4-phase SOP
(`VERIFY_ID → RESOLVE_INTENT → PROCESS_CASE → POST_PROCESS`) while still
conversing naturally. Code owns the state machine and every gate. The LLM
owns language.

> **Status: spec phase. No code yet.** The setup below is the target that
> the build must satisfy. The full design contract is **[SPEC.md](./SPEC.md)**.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind 4
- Anthropic SDK: **Haiku** for per-turn understanding/extraction, **Sonnet**
  for replies and the email summary
- Zod-validated LLM outputs, with SSE streaming to the chat UI
- Deployed on **Render** as a single persistent Node service. All SOP state
  lives server-side.

## Setup (local)

```bash
npm install
cp .env.example .env.local
# set ANTHROPIC_API_KEY (required)
npm run dev
```

Open http://localhost:3000 and chat with the agent. If no server key is
set, you can paste an API key into the UI's optional key field instead. It
is sent per request and is never stored.

### Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes (or supplied via the UI) | none | Model access |
| `MODEL_UNDERSTAND` | no | `claude-haiku-5-5` | Call ①: classify + extract |
| `MODEL_RESPOND` | no | `claude-sonnet-5-5` | Call ⑤: reply, plus the email summary |
| `EMAIL_PROVIDER` | no | `simulated` | Email sender implementation |
| `SOP_TODAY` | no | real date | Fixed "today" for deadline math in demos |

## Docker

```bash
docker build -t sop-agent .
docker run -e ANTHROPIC_API_KEY=sk-... -p 3000:3000 sop-agent
```

## Deploy (Render)

One web service, defined in `render.yaml`:
- Build `npm install && npm run build`, start `next start -p $PORT`
- Set `ANTHROPIC_API_KEY` as a secret env var
- **1 instance, no autoscaling.** Session state lives in the process's
  memory.
- Health check: `/api/health`
- The free tier sleeps after about 15 minutes idle, which wipes open
  sessions. Use Starter while the demo is being reviewed.

## Try it

The canonical test case, sent as the first message:

> I'm the policyholder. My name is Margaret Chen, policy POL-9921. I'm
> calling about my denied healthcare claim from January. DOB is 1985-03-15,
> SSN last four is 4472.

Expected: the agent verifies on that turn, resolves claim CL-2048 from the
remembered hint without asking again, explains the denial from the claim
data, then offers an email summary that you can accept or skip.

The test drawer in the UI has more scripted cases: a frustrated caller, an
off-topic caller, a representative calling for someone else (David Chen),
and a caller with a national ID instead of an SSN (Ma Tian).

## Design summary

See [SPEC.md](./SPEC.md). Key decisions:
- **Two-call pipeline per turn:** Haiku extracts structured facts without
  ever seeing claim data, code runs the phase gates, then Sonnet replies
  using only the data that phase is allowed to see. An output filter
  backstops leaks.
- **Gates are loops:** a phase repeats across turns until its exit condition
  holds. Within a turn, gates that are already satisfied cascade.
- **Verification:** any 3 matching fields on one record, from {name, DOB,
  phone, email, ID last 4, policy number}. After 3 failed attempts
  (mismatch, still short after a re-ask, or refusal), the caller is
  transferred to a human.
- **Cross-phase memory:** anything the caller says is stored on every turn,
  and is only acted on once the right phase is reached.
- **Email:** sent only on an explicit yes, through an `EmailSender`
  abstraction. A simulated sender ships.
