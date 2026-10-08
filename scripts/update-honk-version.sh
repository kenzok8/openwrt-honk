#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAKEFILE="$REPO_DIR/honk/Makefile"
UPSTREAM="${HONK_UPSTREAM_REPO:-Glassyiris/honk}"

command -v gh >/dev/null 2>&1 || { echo "error: gh is required" >&2; exit 1; }

echo "Fetching latest native-api release from $UPSTREAM ..."
tag="$(gh release list --repo "$UPSTREAM" --limit 100 --json tagName,isPrerelease \
  --jq '.[] | select(.tagName | test("debug[.].*native-api")) | .tagName' | head -1)"
[ -n "$tag" ] || { echo "error: no native-api release found" >&2; exit 1; }

echo "Latest release: $tag"

digest_of() {
  local name="$1"
  gh release view "$tag" --repo "$UPSTREAM" --json assets \
    --jq ".assets[] | select(.name == \"$name\") | .digest" | sed 's/^sha256://'
}

x86_hash="$(digest_of 'honk-core-debug-x86_64-unknown-linux-musl-stock.tar.gz')"
aarch64_hash="$(digest_of 'honk-core-debug-aarch64-unknown-linux-musl-stock.tar.gz')"

[ "${#x86_hash}" -eq 64 ] || { echo "error: bad x86_64 digest: ${x86_hash:-<empty>}" >&2; exit 1; }
[ "${#aarch64_hash}" -eq 64 ] || { echo "error: bad aarch64 digest: ${aarch64_hash:-<empty>}" >&2; exit 1; }

# Version: strip the leading "debug." and translate dots into an OpenWrt-safe
# date-ish version (debug.2026.10.7.native-api.1 -> 2026.10.07).
version="$(printf '%s' "$tag" | sed -E 's/^debug\.//; s/^([0-9]{4})\.([0-9]{1,2})\.([0-9]{1,2}).*/\1.\2.\3/')"
# Normalize two-digit month/day.
version="$(printf '%s' "$version" | awk -F. '{printf "%s.%02d.%02d", $1, $2, $3}')"

echo "x86_64:   $x86_hash"
echo "aarch64:  $aarch64_hash"
echo "version:  $version"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

sed \
  -e "s|^HONK_RELEASE_TAG:=.*|HONK_RELEASE_TAG:=$tag|" \
  -e "s|^HONK_HASH_X86_64:=.*|HONK_HASH_X86_64:=$x86_hash|" \
  -e "s|^HONK_HASH_AARCH64:=.*|HONK_HASH_AARCH64:=$aarch64_hash|" \
  -e "s|^PKG_VERSION:=.*|PKG_VERSION:=$version|" \
  -e "s|^PKG_RELEASE:=.*|PKG_RELEASE:=1|" \
  "$MAKEFILE" > "$TMP"

mv "$TMP" "$MAKEFILE"
echo "Updated $MAKEFILE"
