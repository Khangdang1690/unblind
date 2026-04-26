# euler

> unblind the genius math in you.

Upload an image of a math problem, get a tutor that explains the answer and can keep talking — by typing **or by voice** — with retrieval-augmented grounding from a real math textbook.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, MongoDB Atlas (vector search **and** image storage), the [Google GenAI SDK](https://www.npmjs.com/package/@google/genai), and ElevenLabs TTS. Gemini 2.5 Flash drives the OCR pass, the responder pass, and the chat agent loop. The agent has one tool — `searchTextbook` — that runs Atlas `$vectorSearch` over an OpenStax textbook and decides on its own when to use it.

## Features

- **Image → transcribed problem + first response** in one server action (Gemini 2.5 Flash, OCR pass with thinking disabled, then a separate responder pass).
- **Per-problem chat** — keep asking follow-ups on each problem page; the agent has full conversation memory within that problem.
- **Voice mode in the browser** — click *Speak*, ask out loud, stop talking, and the message auto-submits after a configurable silence window. Assistant replies are normalized from LaTeX/markdown into natural spoken English (e.g. `$\frac{a}{b}$` → "a over b") and read aloud via ElevenLabs. Mute toggle, sensitivity slider, auto-send-delay slider, and a live input-level meter all live next to the textarea.
- **Phone-camera capture** — `npm run dev:phone` opens an HTTPS tunnel; visit `/capture` on the laptop to see a QR, scan it with your phone, point at a problem, tap once, and the result page opens automatically.
- **Strict cross-problem isolation** — the agent only ever reads/writes the current problem document; messages from other problems are structurally unreachable.
- **Agentic RAG** — the agent decides per-turn whether to call `searchTextbook` (Atlas Vector Search over a CC-BY-licensed OpenStax textbook). Concept questions trigger retrieval; arithmetic and chit-chat skip it.
- **Retrieval traces** — every tool call and result is persisted as a debug message and rendered in a collapsible "marginalia · show retrieval trace" `<details>` so you can see exactly what the model looked up.
- **MongoDB-backed image storage** — uploaded images are saved as `Binary` documents in the `problem_files` collection, not on disk. The deployment is stateless and survives restarts/migrations without losing assets.
- **Persistent history sidebar** — every problem you've worked on, listed for one-click resume.
- **Editorial schoolbook design** — Fraunces variable display font, marginalia annotations, drop caps, crop marks, italic chrome, cream paper background.
- **Dynamic favicon** — italic `e` rendered at request time via `next/og`, so the brand mark stays in lockstep with palette/font tweaks.
- **Rate-limit-aware Gemini calls** — `generateWithRetry` retries with exponential backoff (2s → 5s → 10s) on 429 responses.
- **Multi-key ingestion** — optional comma-separated key pool rotates around per-key Gemini rate limits when embedding the textbook.

## Prerequisites

- **Node.js 20+** and **npm**
- A free **Gemini API key** from [Google AI Studio](https://aistudio.google.com/app/apikey)
- A free **MongoDB Atlas** cluster (M0 — 512 MB at no cost; vector search is included on the free tier)
- A free **ElevenLabs API key** (10k chars/month) from <https://elevenlabs.io/app/settings/api-keys> — required for the in-browser voice mode

## Setup

```bash
git clone https://github.com/Khangdang1690/unblind.git
cd unblind
npm install
```

### MongoDB Atlas

1. Sign in at <https://www.mongodb.com/cloud/atlas> and create a free **M0** cluster.
2. Under **Database Access**, create a user with a password.
3. Under **Network Access**, allow your current IP (or `0.0.0.0/0` for development).
4. Click **Connect → Drivers** on the cluster and copy the `mongodb+srv://...` connection string.

### Environment variables

Create a `.env` file in the project root.

#### Required

```
GEMINI_API_KEY=your-gemini-key
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority
MONGODB_DB=unblind
ELEVENLABS_API_KEY=your-elevenlabs-key
```

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | OCR (`actions.ts`), responder, chat agent (`agent.ts`), RAG embeddings (`rag.ts`), spoken-text rewrite (`api/tts`). `GOOGLE_API_KEY` is accepted as a fallback. |
| `MONGODB_URI` | Atlas connection string. The app will throw at startup if unset. |
| `MONGODB_DB` | Database name. Defaults to `unblind` if omitted. |
| `ELEVENLABS_API_KEY` | TTS playback in the in-browser voice mode. Without it, `/api/tts` returns 500 and the chat works in text-only mode. |

#### Optional

```
# Override the LLM model (defaults to gemini-2.5-flash)
EULER_MODEL=gemini-2.5-flash

# Override the textbook source id used for RAG queries (defaults to
# openstax-algebra-trig-2e). Useful only if you ingest a different textbook.
EULER_TEXTBOOK_SOURCE=openstax-algebra-trig-2e

# Public HTTPS URL exposed by `npm run dev:phone` so /capture can render a QR.
# Set automatically by that script — only set manually if you bring your own
# tunnel (ngrok, Tailscale Funnel, etc.).
EULER_PUBLIC_URL=https://your-tunnel.example.com

# Comma-separated pool of Gemini API keys used by the ingest script ONLY,
# to rotate around per-key rate limits. Falls back to GEMINI_API_KEY.
GEMINI_API_KEYS=key1,key2,key3
```

#### Standalone CLI voice agent only (`npm run voice`)

```
SERVER_URL=http://localhost:3000                          # the running web app, optional
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json  # Google Cloud Speech-to-Text
PROBLEM_ID=<problemId>                                    # alternative to passing as argv
```

The CLI agent is separate from the in-browser voice mode and uses Google Cloud STT instead of the browser's Web Speech API.

## Ingest the textbook

The agent's `searchTextbook` tool queries an OpenStax math textbook stored in MongoDB. **Algebra and Trigonometry 2e** is the recommended default — broadest school-math coverage and CC-BY 4.0 licensed.

1. Download the PDF from <https://openstax.org/details/books/algebra-and-trigonometry-2e>. Save it to the project root (the file is ignored by git, so the filename can be anything; the default OpenStax filename is `algebra-and-trigonometry-2e_-_WEB.pdf`).
2. Run:
   ```bash
   npm run ingest -- ./algebra-and-trigonometry-2e_-_WEB.pdf
   ```

What the script does:
- Extracts text per page (`pdf-parse` v2)
- Detects chapters / sections
- Splits into ~1,200-character chunks with 200-char overlap (~2,000–2,500 chunks for Algebra & Trig 2e)
- Embeds via Gemini `gemini-embedding-001` at 768 dimensions (Matryoshka truncation via `outputDimensionality`)
- Upserts into the `textbook_chunks` collection (idempotent — re-runs skip already-embedded chunks)
- Ensures the Atlas Vector Search index `textbook_chunks_vector` exists

Free-tier rate limits cap embeddings at ~100 inputs/minute per API key. Set `GEMINI_API_KEYS` to a comma-separated list of multiple free keys to rotate through them; the script will instantly swap on a 429 and only sleep when every key in the pool is exhausted.

After ingestion, confirm in the Atlas UI → Search Indexes that `textbook_chunks_vector` shows status **Active** (build takes 1–3 minutes).

## Run

```bash
npm run dev
```

Open <http://localhost:3000>, upload an image (`.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` up to 10 MB). After the first OCR + response, you can keep chatting on the problem page — typed or spoken. Try:

- **"Explain the quadratic formula"** — the agent calls `searchTextbook`, retrieves passages, and cites a section + page number in the answer.
- **"What's 2+2?"** — the agent answers from its own knowledge; no tool call.
- Click **Speak**, ask out loud, stop talking — the message auto-submits and the reply is read back to you.
- Open the **"marginalia · show retrieval trace"** `<details>` under any assistant turn to see exactly what the tool returned.

## Voice mode

Voice integration is split across two surfaces.

### In the browser (recommended)

Lives on every problem page next to the chat textarea. Web Speech API for STT, ElevenLabs `eleven_turbo_v2` for TTS. Controls:

- **Speak / Stop** — start/stop continuous listening. The textarea shows an interim transcript while you talk.
- **Mute / Unmute** — suppresses TTS playback for the rest of the session.
- **Sensitivity** (1–10) — input-level threshold that drives the volume bars.
- **Auto-send after** (0.5–4 s) — silence window after which the captured text auto-submits.
- **Input-level meter** — colour-shifts green → yellow → red as you get louder, plus a 5-bar VU readout.

Requirements: `ELEVENLABS_API_KEY` in `.env`. STT runs in-browser with no extra credentials (Chrome / Edge work out of the box; Safari requires explicit microphone permission per origin). LaTeX and markdown in assistant replies are rewritten by Gemini into natural spoken English before synthesis (see [`src/app/api/tts/route.ts`](src/app/api/tts/route.ts)).

### Standalone CLI (`npm run voice <problemId>`)

A terminal-based voice loop that talks to the running web app's chat API. Uses Google Cloud Speech-to-Text instead of the browser's Web Speech API, so it needs the system `sox` binary plus a Google Cloud service-account key:

```bash
brew install sox
# .env additions:
ELEVENLABS_API_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
SERVER_URL=http://localhost:3000   # optional
```

Then:

```bash
npm run dev                          # in one terminal
npm run voice <problemId>            # in another (problemId from /problems/<id> URL)
```

Mostly useful for terminal-only environments or eyes-free demos. The in-browser flow is the recommended path for everyday use.

## Capture from your phone

```bash
npm run dev:phone
```

This starts the dev server **and** opens a public HTTPS tunnel via [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) using the [`cloudflared`](https://www.npmjs.com/package/cloudflared) npm package — no signup, no auth, no interstitial, works on iOS Safari. The tunnel URL is exposed to Next via `EULER_PUBLIC_URL`. Open <http://localhost:3000/capture> in your laptop browser: you'll see a QR code. Scan it with your phone (Camera app, not Safari directly), allow camera access on the page that opens, point at a math problem, tap **Capture**. The result page opens automatically with the chat.

The `cloudflared` package downloads the cloudflared binary on `npm install`. The tunnel only stays alive while `npm run dev:phone` is running; the URL stays stable for the entire session and changes each time you restart the script.

If you'd rather skip the tunnel and use the camera page directly on the laptop (Chrome/Edge allow `getUserMedia` over `localhost`), just `npm run dev` and visit `/capture` normally.

## How it works

### Upload flow ([`src/app/actions.ts`](src/app/actions.ts))
1. Server action receives the image bytes.
2. Gemini OCR pass transcribes the problem statement (thinking disabled — transcription doesn't need reasoning).
3. Gemini responder pass produces an initial answer.
4. Image bytes are written to MongoDB as a `Binary` document via `saveProblemFile` (collection `problem_files`, indexed by `problemId`); the problem document with three seed messages — file, extraction, response — goes to the `problems` collection in one `createProblem` call.

### Chat flow ([`src/lib/agent.ts`](src/lib/agent.ts))
1. The chat UI POSTs to `/api/problems/{id}/chat` with the user's message.
2. `runAgent` loads the problem (the **only** DB read for context — this is what enforces per-problem isolation), builds a Gemini `Content[]` from the conversation history, and runs a function-calling loop.
3. Each turn, the model can either emit a final text answer or call `searchTextbook(query, k)`. The system prompt tells it to call the tool only for textbook-style concept questions (definitions, theorems, formulas, worked examples) and skip it for arithmetic and chit-chat.
4. Loop terminates when the model emits a turn with no function calls. Capped at 4 rounds; if the cap fires, one final call with `tools: []` forces a text reply.
5. New messages — the user turn, every tool-call/tool-result trace, and the final assistant turn — are appended to the problem in one update via `appendMessages(id, msgs)`.
6. Every Gemini call is wrapped in `generateWithRetry`, which retries on 429s with backoff `[2s, 5s, 10s]`.

### TTS flow ([`src/app/api/tts/route.ts`](src/app/api/tts/route.ts))
1. The chat UI POSTs each new assistant reply to `/api/tts`.
2. A Gemini call rewrites the markdown/LaTeX into natural spoken English (`$x^2$` → "x squared", `$\int_a^b$` → "the integral from a to b", markdown headings stripped).
3. ElevenLabs (`eleven_turbo_v2`, voice "George") synthesises the spoken text and streams the MP3 back to the browser, which plays it via a single `<audio>` element. Mute pauses any in-flight playback.

### RAG retrieval ([`src/lib/rag.ts`](src/lib/rag.ts))
- Embedding: Gemini `gemini-embedding-001` at 768 dimensions (`outputDimensionality` truncation).
- Aggregation:
  ```js
  { $vectorSearch: {
      index: "textbook_chunks_vector",
      path: "embedding",
      queryVector,
      numCandidates: 150,
      limit: 4,
      filter: { source: TEXTBOOK_SOURCE },
  }}
  ```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run dev:phone` | Dev server + public HTTPS tunnel for `/capture` (QR-code flow) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run ingest -- <pdf>` | Embed a textbook PDF into MongoDB Atlas |
| `npm run voice <problemId>` | Standalone CLI voice agent — talks to the running web app via `/api/problems/{id}/chat` |

## Project structure

```
src/
  app/
    layout.tsx                          Root layout (html shell, Geist + Fraunces fonts, providers)
    icon.tsx                            Dynamic favicon — italic "e" rendered via next/og
    globals.css                         Tailwind v4 + editorial palette, fonts, utilities
    actions.ts                          Upload server action (OCR + first response + MongoDB save)
    (app)/                              Route group for sidebar-wrapped pages
      layout.tsx                        Sidebar + header chrome
      page.tsx                          Upload page
      problems/[id]/
        page.tsx                        Problem detail page (server-rendered)
        chat.tsx                        Client chat UI: text + voice (mic, level meter, TTS)
        delete-problem-button.tsx
    capture/
      page.tsx                          Server component — QR (on laptop) or React camera fallback
      capture-client.tsx                React camera UI used when EULER_PUBLIC_URL is unset
    api/
      solve/route.ts                    POST handler used by public/cam.html
      tts/route.ts                      POST: assistant text → spoken English → ElevenLabs MP3
      problems/[id]/
        route.ts                        GET: returns the full problem JSON (used by voice CLI)
        file/route.ts                   Serves the uploaded image from MongoDB
        chat/route.ts                   POST endpoint that runs the agent
  lib/
    mongodb.ts                          Cached client + getDb()
    problems.ts                         Problem CRUD + saveProblemFile/getProblemFile (image storage)
    rag.ts                              searchTextbook + embedText
    agent.ts                            runAgent loop, tool wiring, persistence, generateWithRetry
    strip-markdown.ts                   Markdown/LaTeX → plain text (used by voice agent CLI)
public/
  cam.html                              Static phone-camera page (vanilla JS, no React)
scripts/
  dev-phone.ts                          npm run dev:phone — dev server + Cloudflare tunnel + QR
  ingest-textbook.ts                    PDF → chunks → embeddings → MongoDB
  voice-agent.ts                        Standalone CLI voice agent (Google Cloud STT + ElevenLabs TTS)
```
