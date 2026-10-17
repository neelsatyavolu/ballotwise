import {
  authorizeUrl,
  bundledModels,
  exchangeCode,
  generatePkce,
  loadModels,
  parseCallback,
  refreshTokens,
  selectModels,
  type Tokens,
} from "@neelsatyavolu/shared-ai-auth";

// Grok is the only provider this app accepts. Codex is never offered.
export type GrokTokens = Tokens;
export const GROK_API_BASE = process.env.GROK_API_BASE_URL ?? "https://api.x.ai/v1";

export function startGrokSignIn(): { verifier: string; state: string; url: string } {
  const pkce = generatePkce();
  return { verifier: pkce.verifier, state: pkce.state, url: authorizeUrl("grok", pkce) };
}

export function readGrokCallback(input: string) {
  return parseCallback(input);
}

export function exchangeGrokCode(code: string, verifier: string): Promise<GrokTokens> {
  return exchangeCode("grok", code, verifier);
}

export function refreshGrokTokens(previous: GrokTokens): Promise<GrokTokens> {
  return refreshTokens("grok", previous.refreshToken, { previous });
}

let catalog = bundledModels;
let catalogRefreshAt = 0;

// Grok 4.6 at low effort finished a full candidate profile in 31-48 s versus 67-150 s for Grok 4.7 (measured 2026-10-16).
const PREFERRED_MODEL = "grok-4.6";

/** The preferred model while the shared catalog lists it, otherwise the catalog's first Grok model. */
export async function grokModel(): Promise<string> {
  if (process.env.GROK_MODEL) return process.env.GROK_MODEL;
  if (Date.now() >= catalogRefreshAt) {
    catalog = await loadModels({ fallback: catalog });
    catalogRefreshAt = Date.now() + 5 * 60_000;
  }
  const models = selectModels(catalog, "grok");
  return models.find((m) => m.id === PREFERRED_MODEL)?.id ?? models[0].id;
}
