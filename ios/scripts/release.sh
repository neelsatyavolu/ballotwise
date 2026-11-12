#!/usr/bin/env bash
# Archive Ballotwise for iPhone, sign it for the App Store and upload it to TestFlight.
#
#   ios/scripts/release.sh              # archive + upload to App Store Connect
#   ios/scripts/release.sh --no-upload  # archive + export build/Ballotwise.ipa only
#
# Needs the release Xcode (App Store Connect rejects beta-Xcode builds) and XcodeGen. Nothing
# secret lives in this file:
#   - The App Store Connect API key is the .p8 in ~/.appstoreconnect/private_keys/.
#   - When the 1Password CLI is already signed in, the Apple Distribution certificate (.p12 +
#     password) is read from it into a temporary keychain that is deleted on exit. Otherwise (or
#     with BALLOTWISE_CLOUD_SIGNING=1) the export uses App Store Connect cloud-managed distribution
#     signing through the API key, and no local distribution certificate is needed.
# Signing is automatic; xcodebuild creates or refreshes the App Store profile itself
# (-allowProvisioningUpdates with the API key). The archive is signed with the team's Apple
# Development identity and re-signed for distribution on export.
#
# Overrides: BALLOTWISE_OP_ACCOUNT, BALLOTWISE_OP_VAULT, BALLOTWISE_CERT_ITEM, ASC_KEY_ID, ASC_ISSUER_ID,
# BUILD_NUMBER (default: UTC yyyymmddHHMM).
set -euo pipefail

UPLOAD=1
[ "${1:-}" = "--no-upload" ] && UPLOAD=0

IOS="$(cd "$(dirname "$0")/.." && pwd)"
cd "$IOS"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
case "$DEVELOPER_DIR" in
  *beta*|*Beta*) echo "error: $DEVELOPER_DIR is a beta Xcode; App Store Connect rejects its builds" >&2; exit 1 ;;
esac

OP_ACCOUNT="${BALLOTWISE_OP_ACCOUNT:-E3OXZANXQRDOBNXQMPXZ6YBHTY}"
VAULT="${BALLOTWISE_OP_VAULT:-Personal}"
CERT_ITEM="${BALLOTWISE_CERT_ITEM:-Apple Distribution Certificate}"
TEAM_ID="VTQW687WBQ"
KEY_ID="${ASC_KEY_ID:-U27MTWCKH5}"
ISSUER_ID="${ASC_ISSUER_ID:-ec1e9e67-6c4b-44da-9ef7-39a0d5925d2d}"
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"

[ -f "$KEY_PATH" ] || { echo "error: App Store Connect key not found at $KEY_PATH" >&2; exit 1; }
# Never prompt: a signed-in 1Password CLI supplies the certificate, anything else means cloud signing.
LOCAL_CERT=0
if [ "${BALLOTWISE_CLOUD_SIGNING:-0}" != 1 ] && command -v op >/dev/null \
  && op --account "$OP_ACCOUNT" whoami >/dev/null 2>&1 </dev/null; then
  LOCAL_CERT=1
fi
command -v xcodegen >/dev/null || { echo "error: xcodegen is not installed (brew install xcodegen)" >&2; exit 1; }

WORK="$(mktemp -d)"
KEYCHAIN="$WORK/signing.keychain-db"
# Other builds on this Mac may edit the keychain search list at the same time, so only ever
# add or remove our own keychain; never restore a snapshot.
# Each search-list line is an indented, quoted path; paths may contain spaces.
OTHERS=()
read_others() {
  OTHERS=()
  local line
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line#\"}"
    line="${line%\"}"
    [ -n "$line" ] && [ "$line" != "$KEYCHAIN" ] && OTHERS+=("$line")
  done < <(security list-keychains -d user || true)
}
use_keychain() {
  read_others
  security list-keychains -d user -s "$KEYCHAIN" ${OTHERS[@]+"${OTHERS[@]}"}
}
cleanup() {
  # Never let a search-list error skip deleting the keychain and the work folder.
  set +e
  read_others
  [ "${#OTHERS[@]}" -gt 0 ] && security list-keychains -d user -s "${OTHERS[@]}"
  security delete-keychain "$KEYCHAIN" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "› Generating the Xcode project"
xcodegen generate --quiet

if [ "$LOCAL_CERT" = 1 ]; then
  echo "› Loading the distribution certificate into a temporary keychain"
  op --account "$OP_ACCOUNT" read "op://$VAULT/$CERT_ITEM/AppleDistribution_${TEAM_ID}.p12" --out-file "$WORK/dist.p12" >/dev/null </dev/null
  KEYCHAIN_PASSWORD="$(openssl rand -hex 16)"
  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security set-keychain-settings -lut 3600 "$KEYCHAIN"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security import "$WORK/dist.p12" -k "$KEYCHAIN" -P "$(op --account "$OP_ACCOUNT" read "op://$VAULT/$CERT_ITEM/password" </dev/null)" \
    -T /usr/bin/codesign -T /usr/bin/security >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
  rm -f "$WORK/dist.p12"
  use_keychain
else
  echo "› 1Password isn't signed in: using App Store Connect cloud-managed distribution signing"
fi

AUTH=(-allowProvisioningUpdates
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID")

VERSION="$(grep -E 'MARKETING_VERSION:' project.yml | head -1 | sed -E 's/.*"(.*)".*/\1/')"
echo "› Archiving Ballotwise $VERSION ($BUILD_NUMBER)"
xcodebuild -project Ballotwise.xcodeproj -scheme Ballotwise -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$WORK/Ballotwise.xcarchive" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID" \
  "${AUTH[@]}" archive -quiet

DESTINATION=export
[ "$UPLOAD" = 1 ] && DESTINATION=upload
cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

[ "$LOCAL_CERT" = 1 ] && use_keychain  # in case another build replaced the search list while we archived
if [ "$UPLOAD" = 1 ]; then echo "› Uploading to App Store Connect"; else echo "› Exporting build/Ballotwise.ipa"; fi
xcodebuild -exportArchive -archivePath "$WORK/Ballotwise.xcarchive" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" -exportPath "$WORK/export" \
  "${AUTH[@]}" -quiet

if [ "$UPLOAD" = 1 ]; then
  echo "✓ Ballotwise $VERSION ($BUILD_NUMBER) uploaded. It shows in TestFlight once Apple finishes processing (usually 5-15 minutes)."
else
  mkdir -p build
  cp "$WORK/export/"*.ipa build/Ballotwise.ipa
  echo "✓ ios/build/Ballotwise.ipa ($VERSION, build $BUILD_NUMBER)"
fi
