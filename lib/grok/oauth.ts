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

// Grok is the default and recommended provider. A ChatGPT account (the shared package's "codex" provider) is the alternative.
export const AI_PROVIDERS = ["grok", "codex"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const PROVIDER_LABEL: Record<AiProvider, string> = { grok: "Grok", codex: "ChatGPT" };

/** Tokens for the account's one AI connection, tagged with the provider that issued them. */
export type GrokTokens = Tokens & { provider: AiProvider };
export const GROK_API_BASE = process.env.GROK_API_BASE_URL ?? "https://api.x.ai/v1";
export const CODEX_RESPONSES_URL = process.env.CODEX_RESPONSES_URL ?? "https://chatgpt.com/backend-api/codex/responses";

export function startGrokSignIn(provider: AiProvider = "grok"): { verifier: string; state: string; url: string } {
  const pkce = generatePkce();
  return { verifier: pkce.verifier, state: pkce.state, url: authorizeUrl(provider, pkce) };
}

export function readGrokCallback(input: string) {
  return parseCallback(input);
}

export async function exchangeGrokCode(code: string, verifier: string, provider: AiProvider = "grok"): Promise<GrokTokens> {
  return { ...(await exchangeCode(provider, code, verifier)), provider };
}

export async function refreshGrokTokens(previous: GrokTokens): Promise<GrokTokens> {
  return { ...(await refreshTokens(previous.provider, previous.refreshToken, { previous })), provider: previous.provider };
}

let catalog = bundledModels;
let catalogRefreshAt = 0;

// Grok 4.6 at low effort finished a full candidate profile in 31-48 s versus 67-150 s for Grok 4.7 (measured 2026-10-16).
const PREFERRED_MODEL: Record<AiProvider, string> = { grok: "grok-4.6", codex: "gpt-6.1-sol" };
const MODEL_ENV: Record<AiProvider, string | undefined> = { grok: process.env.GROK_MODEL, codex: process.env.CODEX_MODEL };

/** The preferred model while the shared catalog lists it, otherwise the catalog's first model for that provider. */
export async function grokModel(provider: AiProvider = "grok"): Promise<string> {
  const override = MODEL_ENV[provider];
  if (override) return override;
  if (Date.now() >= catalogRefreshAt) {
    catalog = await loadModels({ fallback: catalog });
    catalogRefreshAt = Date.now() + 5 * 60_000;
  }
  const models = selectModels(catalog, provider);
  return models.find((m) => m.id === PREFERRED_MODEL[provider])?.id ?? models[0].id;
}
