# unblind

Upload an image of a math problem (text + equations), get the problem statement transcribed and a model-generated response — all from one page.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, and the [Google GenAI SDK](https://www.npmjs.com/package/@google/genai). Gemini 2.5 Flash runs both the OCR pass and the responder pass via a single Server Action — the API key never leaves the server.

## Prerequisites

- **Node.js 20+** and **npm**
- A free **Gemini API key** from [Google AI Studio](https://aistudio.google.com/app/apikey) (the free tier covers 1,500 requests/day)
- A free **MongoDB Atlas** cluster (the M0 tier gives you 512 MB at no cost)

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

### `.env`

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your-key-here
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority
MONGODB_DB=unblind
```

Optional model override (defaults to `gemini-2.5-flash`):

```
UNBLIND_MODEL=gemini-2.5-flash
```

## Run

```bash
npm run dev
```

Open <http://localhost:3000>, pick an image (`.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` up to 10 MB), and click **Submit**. The first card shows the transcribed problem statement (with `$...$` LaTeX for inline math), the second shows the model's response.

A sample worksheet lives at `data/image.png` if you want something to try.

## How it works

1. The browser sends the image bytes to a Next.js Server Action ([`src/app/actions.ts`](src/app/actions.ts)).
2. **Persist:** the file is saved as a BSON document in the `uploads` collection (`filename`, `mimeType`, `size`, raw `data`, `uploadedAt`). Done before any model call so a Gemini failure never loses the upload.
3. **OCR pass:** Gemini 2.5 Flash transcribes the problem statement. Thinking is disabled (`thinkingBudget: 0`) — transcription doesn't need reasoning, and skipping it cuts latency.
4. **Responder pass:** The transcribed text is sent back to Gemini 2.5 Flash with default thinking enabled, asking for a response to the problem(s).
5. Both results are returned to the page and rendered in two cards.

Each submit consumes two requests against your Gemini quota and writes one document to MongoDB.

## Scripts

| Command          | Purpose                       |
| ---------------- | ----------------------------- |
| `npm run dev`    | Start the dev server (Turbopack) |
| `npm run build`  | Production build              |
| `npm run start`  | Serve the production build    |
| `npm run lint`   | Run ESLint                    |
