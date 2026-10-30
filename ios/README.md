# Ballotwise for iOS

A native SwiftUI app for the midterms tracker. It has live results, race pages with county maps, the national map, the forecast, race calls, search across every civicAPI race, dashboards with Grok chat, and push alerts. It reads the same API as the website (`https://ballotwise.xanom.co/api/...`) and signs in with the same accounts. For now the voter guide opens on the website.

## Build

```bash
cd ios
xcodegen generate          # after adding or removing files; project.yml is the source of truth
open Ballotwise.xcodeproj
```

Team `VTQW687WBQ` (Xanom), bundle id `co.xanom.ballotwise`, iOS 18+. Signing is automatic. Command-line builds can provision with the App Store Connect API key in 1Password ("Xanom Apple Dev Creds", key `U27MTWCKH5`). Pass `-allowProvisioningUpdates -authenticationKeyPath … -authenticationKeyID U27MTWCKH5 -authenticationKeyIssuerID ec1e9e67-6c4b-44da-9ef7-39a0d5925d2d`.

Debug builds take `-BWTab races|map|forecast|more` and `-BWRace <id>` as launch arguments, so simulator screenshots can open a given screen.

## Push alerts

The app registers its APNs token, alert choices, starred races and home state with `POST /api/push`. The Worker's 5-minute cron (`custom-worker.ts`, then `lib/push/dispatch.ts`) sends these alerts:

- **Starred race called:** a call, a changed call or a withdrawal in a race the device starred.
- **Chamber control:** the Senate or House is decided, and Senate or governor seats change party, including corrections. A chamber only counts as decided once the majority holds across two cron runs.
- **Every race call:** off by default. More than three calls in one run arrive as a single summary.
- **Polls closing:** each closing wave, led by the device's own state when it's in that wave.

Server setup, once:

```bash
npx wrangler d1 migrations apply ballotwise --remote        # 0013_push.sql
npx wrangler secret put APNS_KEY       # contents of AuthKey_4D2Q9WPRZG.p8 (1Password, "Xanom Apple Dev Creds")
npx wrangler secret put APNS_KEY_ID    # 4D2Q9WPRZG
npx wrangler secret put APNS_TEAM_ID   # VTQW687WBQ
```

`APNS_TOPIC` (the bundle id) is a var in `wrangler.jsonc`. Without the secrets, the cron skips push. Debug builds register as `sandbox` and TestFlight or App Store builds as `production`. APNs needs HTTP/2, which deployed Workers have but `wrangler dev` doesn't, so pushes can only be tested on the deployed Worker.
