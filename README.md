# Ballotwise

A nonpartisan voter guide. Look up any race and see every candidate's positions side by side, each claim linked to its source. Add your address and Ballotwise finds every contest on your ballot, including judges and ballot measures, researches each one in the background, and tracks which ones you've voted in.

It also has a live tracker for the 2026 midterms at `/midterms`: results, county maps and race ratings for every House, Senate and Governor race and statewide ballot measure.

Live at **https://ballotwise.xanom.co**.

## How it stays neutral

- Every candidate is researched by a separate request with the same template. The model never sees one candidate's profile while writing another's.
- Every claim needs a source. Citations to pages the model didn't actually retrieve during that search are removed, and claims left without a source are dropped.
- Which side of an issue is listed first is a coin flip per issue, and candidate order is shuffled on every visit.
- In the voter guide, colors never map to candidates or parties. Red marks only the voter's own answers. (The midterms tracker uses the usual blue and red for party results.)
- The match is arithmetic on the voter's answers, not AI, and every step can be inspected and corrected. See [`lib/match.ts`](lib/match.ts) and the in-app "How it works" page.

## Stack

- Next.js 16 on Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare)
- Cloudflare D1 for accounts, sessions, saved guides and ballots; Cloudflare Queues for background research ([`custom-worker.ts`](custom-worker.ts))
- Research runs on each user's own AI account, signed in with [`@neelsatyavolu/shared-ai-auth`](https://github.com/neelsatyavolu/shared-ai-auth). Grok (xAI Responses API with server-side web search) is the default and recommended choice; a ChatGPT account can be connected instead. One connection per account.
- Districts from the [US Census geocoder](https://geocoding.geo.census.gov/); ballot measure summaries from Ballotpedia
- Midterms tracker: live results from [civicAPI](https://civicapi.org), race ratings from Kalshi and Polymarket prices and VoteHub polls, refreshed by a cron trigger every 5 minutes
- Password reset email through Resend

## Develop

```bash
npm install
npx wrangler d1 migrations apply ballotwise --local
echo "GROK_TOKEN_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" > .dev.vars
npm run dev        # Next dev server (no queue consumer)
npm run preview    # full Worker build with the queue consumer, on wrangler dev
npm test           # vitest: matching, sourcing rules, accounts, vault, background jobs, midterms
```

`RESEND_API_KEY` is only needed for password reset email.

## Deploy

Every push to `main` runs lint, tests and `npm run deploy` in GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). Migrations are not applied there; run them by hand first when a change adds one:

```bash
npx wrangler d1 migrations apply ballotwise --remote
npm run deploy     # manual deploy, same as CI
```

Secrets, set once with `wrangler secret put`: `GROK_TOKEN_KEY` (32 random bytes, base64; encrypts stored Grok or ChatGPT tokens) and `RESEND_API_KEY`.

## License

[MIT](LICENSE)
