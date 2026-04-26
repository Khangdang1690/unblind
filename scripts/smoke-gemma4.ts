/**
 * Smoke test — confirms two things:
 *
 *   1. `gemma-4-31b-it` is callable through the @google/genai SDK and
 *      function-calling works (the capability the agent loop relies on).
 *
 *   2. The GEMINI_API_KEYS pool has at least one key with available quota
 *      for `gemini-2.5-flash`, so the new key-rotation helper in
 *      `src/lib/gemini-pool.ts` will be able to keep the app running when
 *      one key 429s.
 *
 * Run:
 *   npx ts-node --project scripts/tsconfig.json scripts/smoke-gemma4.ts
 *
 * Untracked / ad-hoc — delete or git-ignore once you're done iterating.
 */

import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

function loadKeys(): string[] {
  const multi = process.env.GEMINI_API_KEYS;
  if (multi) {
    const parts = multi.split(",").map((k) => k.trim()).filter(Boolean);
    if (parts.length > 0) return parts;
  }
  const single = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  return single ? [single] : [];
}

const keys = loadKeys();
if (keys.length === 0) {
  console.error("No keys in env. Set GEMINI_API_KEYS or GEMINI_API_KEY.");
  process.exit(1);
}
console.log(`Loaded ${keys.length} key(s).`);

function isRateLimit(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    return (err as { status: number }).status === 429;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|quota|exceeded/i.test(msg);
}

async function ping(model: string, ai: GoogleGenAI): Promise<"ok" | "429" | "err"> {
  try {
    await ai.models.generateContent({
      model,
      contents: [{ text: "Say 'ok' and nothing else." }],
      config: { maxOutputTokens: 16 },
    });
    return "ok";
  } catch (err) {
    return isRateLimit(err) ? "429" : "err";
  }
}

async function withTool(model: string, ai: GoogleGenAI): Promise<"ok" | "no-tool" | "err"> {
  try {
    const resp = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "What does the textbook say about the chain rule? Use the searchTextbook tool to look it up.",
            },
          ],
        },
      ],
      config: {
        systemInstruction:
          "You are a math tutor. Use the searchTextbook tool when asked about a concept.",
        maxOutputTokens: 256,
        tools: [
          {
            functionDeclarations: [
              {
                name: "searchTextbook",
                description: "Look up a concept in the math textbook.",
                parametersJsonSchema: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                    k: { type: "integer", minimum: 1, maximum: 8 },
                  },
                  required: ["query"],
                },
              },
            ],
          },
        ],
      },
    });
    return (resp.functionCalls ?? []).length > 0 ? "ok" : "no-tool";
  } catch {
    return "err";
  }
}

async function main(): Promise<void> {
  console.log("\n── Gemma 4 capability checks (key #1 only) ─────────");
  const ai0 = new GoogleGenAI({ apiKey: keys[0] });
  console.log("plain text:", await ping("gemma-4-31b-it", ai0));
  console.log("function calling:", await withTool("gemma-4-31b-it", ai0));

  console.log("\n── Per-key Gemini 2.5 Flash quota probe ────────────");
  let okCount = 0;
  for (let i = 0; i < keys.length; i++) {
    const ai = new GoogleGenAI({ apiKey: keys[i] });
    const result = await ping("gemini-2.5-flash", ai);
    console.log(`key #${i + 1}: ${result}`);
    if (result === "ok") okCount++;
  }
  console.log(`\nFresh keys: ${okCount}/${keys.length}`);
  console.log(
    okCount > 0
      ? "✅ Rotation will save you — when key #1 429s, the pool will rotate to a key with quota."
      : "⚠️  All keys are currently rate-limited; rotation will sleep and retry. Add more keys or wait for quota reset.",
  );
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
