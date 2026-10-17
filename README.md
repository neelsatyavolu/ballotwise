# Ballotwise

A nonpartisan voter guide. Look up any race and see every candidate's positions side by side, each claim linked to its source. Add your address and Ballotwise finds every contest on your ballot, researches each one in the background, and tracks which ones you've voted in.

Live at **https://ballotwise.xanom.co**.

## How it stays neutral

- Every candidate is researched by a separate request with the same template. The model never sees one candidate's profile while writing another's.
- Every claim needs a source. Citations to pages Grok didn't actually retrieve during that search are removed, and claims left without a source are dropped.
- Which side of an issue is listed first is a coin flip per issue, and candidate order is shuffled on every visit.
- Colors never map to candidates or parties. Red marks only the voter's own answers.
- The match is arithmetic on the voter's answers, not AI, and every step can be inspected and corrected. See [`lib/match.ts`](lib/match.ts) and the in-app "How it works" page.

## Stack

- Next.js 16 on Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare)
- Cloudflare D1 for accounts, sessions, saved guides and ballots; Cloudflare Queues for background research ([`custom-worker.ts`](custom-worker.ts))
- Research by Grok (xAI Responses API with server-side web search) on each user's own Grok account, signed in with [`@neelsatyavolu/shared-ai-auth`](https://github.com/neelsatyavolu/shared-ai-auth). Grok is the only provider offered.
- Districts from the [US Census geocoder](https://geocoding.geo.census.gov/)
- Password reset email through Resend

## Develop

```bash
npm install
npx wrangler d1 migrations apply ballotwise --local
echo "GROK_TOKEN_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" > .dev.vars
npm run dev        # Next dev server (no queue consumer)
npm run preview    # full Worker build with the queue consumer, on wrangler dev
npm test           # vitest: matching, sourcing rules, accounts, vault, background jobs
```

`RESEND_API_KEY` is only needed for password reset email.

## Deploy

```bash
npx wrangler d1 migrations apply ballotwise --remote
npm run deploy
```

Secrets, set once with `wrangler secret put`: `GROK_TOKEN_KEY` (32 random bytes, base64; encrypts stored Grok tokens) and `RESEND_API_KEY`.

## License

[MIT](LICENSE)
