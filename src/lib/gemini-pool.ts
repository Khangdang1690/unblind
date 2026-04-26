import { GoogleGenAI } from "@google/genai";

type Pool = {
  clients: GoogleGenAI[];
  cursor: number;
};

let cached: Pool | null = null;

function buildPool(): Pool {
  const keys: string[] = [];
  const multi = process.env.GEMINI_API_KEYS;
  if (multi) {
    for (const k of multi.split(",")) {
      const t = k.trim();
      if (t) keys.push(t);
    }
  }
  if (keys.length === 0) {
    const single = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (single) keys.push(single);
  }
  if (keys.length === 0) {
    throw new Error(
      "No Gemini API keys configured. Set GEMINI_API_KEYS (comma-separated) or GEMINI_API_KEY in .env.",
    );
  }
  return {
    clients: keys.map((apiKey) => new GoogleGenAI({ apiKey })),
    cursor: 0,
  };
}

function getPool(): Pool {
  if (!cached) cached = buildPool();
  return cached;
}

export function poolSize(): number {
  return getPool().clients.length;
}

function isRateLimitError(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    return (err as { status: number }).status === 429;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|quota|exceeded/i.test(msg);
}

function parseRetryDelayMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const msg = (err as { message?: unknown }).message;
  if (typeof msg !== "string") return null;
  const seconds = /retry in ([\d.]+)s/i.exec(msg);
  if (seconds) return Math.ceil(parseFloat(seconds[1]) * 1000);
  const json = /"retryDelay":\s*"(\d+)s"/.exec(msg);
  if (json) return parseInt(json[1], 10) * 1000;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const MAX_CYCLES = 3;

async function rotate<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const p = getPool();
  const n = p.clients.length;
  let lastErr: unknown;

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    let longestHint = 0;
    for (let i = 0; i < n; i++) {
      const idx = p.cursor % n;
      const ai = p.clients[idx];
      p.cursor = (p.cursor + 1) % n;
      try {
        return await fn(ai);
      } catch (err) {
        lastErr = err;
        if (!isRateLimitError(err)) throw err;
        const hint = parseRetryDelayMs(err) ?? 0;
        if (hint > longestHint) longestHint = hint;
        if (n > 1) {
          console.warn(
            `Gemini key #${idx + 1}/${n} rate-limited; rotating to next key.`,
          );
        }
      }
    }
    // Every key in the pool 429'd this cycle. Back off and try again.
    const backoff = Math.max(longestHint, Math.min(60_000, 5_000 * 2 ** cycle));
    const wait = backoff + 2_000;
    console.warn(
      `All ${n} Gemini keys rate-limited; sleeping ${Math.round(
        wait / 1000,
      )}s before cycle ${cycle + 2}/${MAX_CYCLES}.`,
    );
    await sleep(wait);
  }
  throw lastErr;
}

type GenContentArgs = Parameters<GoogleGenAI["models"]["generateContent"]>[0];
type GenContentResp = Awaited<
  ReturnType<GoogleGenAI["models"]["generateContent"]>
>;

export function generateContent(args: GenContentArgs): Promise<GenContentResp> {
  return rotate((ai) => ai.models.generateContent(args));
}

type EmbedArgs = Parameters<GoogleGenAI["models"]["embedContent"]>[0];
type EmbedResp = Awaited<ReturnType<GoogleGenAI["models"]["embedContent"]>>;

export function embedContent(args: EmbedArgs): Promise<EmbedResp> {
  return rotate((ai) => ai.models.embedContent(args));
}
