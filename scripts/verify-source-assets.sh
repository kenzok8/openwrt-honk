#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
# Verify the download metadata the feed ships with: the core archives for three
# architectures plus the Doona archive. Static consistency lives in
# scripts/check.sh; this script is the network half, so it runs only on the
# heavy gate (candidate promotion) and on demand.
#
# Usage:
#   scripts/verify-source-assets.sh [--tag source-<run_id>] [--download]
#
#   --tag       verify against this source tag instead of the committed one
#   --download  actually fetch every asset and compare its SHA-256
#
# Without --download only the URLs are probed (HEAD), which is what a quick
# review wants; the promotion gate must pass --download.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

tag_override=
download=false
while [ $# -gt 0 ]; do
	case "$1" in
	--tag)
		[ $# -ge 2 ] || { echo "--tag needs a value" >&2; exit 2; }
		tag_override=$2
		shift 2
		;;
	--download)
		download=true
		shift
		;;
	-h | --help)
		sed -n '2,20p' "$0"
		exit 0
		;;
	*)
		echo "unknown argument: $1" >&2
		exit 2
		;;
	esac
done

value() { # <file> <var>
	sed -n "s/^$2[?:]*=//p" "$1" | tail -1
}

core_commit=$(value honk/Makefile CORE_COMMIT)
core_tag=$(value honk/Makefile HONK_SOURCE_TAG)
doona_tag=$(value luci-app-honk/Makefile HONK_SOURCE_TAG)
doona_archive=$(value luci-app-honk/Makefile PKG_SOURCE)
doona_hash=$(value luci-app-honk/Makefile PKG_HASH)
tag=${tag_override:-$core_tag}

[[ "$core_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid CORE_COMMIT: ${core_commit:-<empty>}" >&2; exit 1; }
[[ "$tag" =~ ^source-[0-9A-Za-z._-]+$ ]] || { echo "invalid source tag: ${tag:-<empty>}" >&2; exit 1; }
if [ -z "$tag_override" ] && [ "$core_tag" != "$doona_tag" ]; then
	echo "honk and luci-app-honk disagree on the source tag: $core_tag vs $doona_tag" >&2
	exit 1
fi

base="https://github.com/kenzok8/openwrt-honk/releases/download/$tag"
declare -a names hashes
for arch in x86_64 aarch64 armv7; do
	var="HONK_HASH_$(printf '%s' "$arch" | tr 'a-z' 'A-Z')"
	names+=("honk-core-$core_commit-$arch.tar.gz")
	hashes+=("$(value honk/Makefile "$var")")
done
names+=("$doona_archive")
hashes+=("$doona_hash")

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
failed=0
printf 'source tag: %s\n' "$tag"
for i in "${!names[@]}"; do
	name=${names[$i]}
	expected=${hashes[$i]}
	url="$base/$name"
	if [[ ! "$expected" =~ ^[0-9a-f]{64}$ ]]; then
		printf 'FAIL %-64s invalid SHA-256 in Makefile: %s\n' "$name" "${expected:-<empty>}"
		failed=1
		continue
	fi
	if ! $download; then
		code=$(curl -sIL -o /dev/null -w '%{http_code}' "$url" || echo 000)
		if [ "$code" = 200 ]; then
			printf 'OK   %-64s %s\n' "$name" "$expected"
		else
			printf 'FAIL %-64s HTTP %s\n' "$name" "$code"
			failed=1
		fi
		continue
	fi
	if ! curl -fsSL --retry 3 -o "$workdir/$name" "$url"; then
		printf 'FAIL %-64s download failed\n' "$name"
		failed=1
		continue
	fi
	actual=$(sha256sum "$workdir/$name" | cut -d' ' -f1)
	if [ "$actual" = "$expected" ]; then
		printf 'OK   %-64s %s\n' "$name" "$expected"
	else
		printf 'FAIL %-64s SHA-256 %s != %s\n' "$name" "$actual" "$expected"
		failed=1
	fi
done

[ "$failed" -eq 0 ] || { echo 'Source asset verification failed.' >&2; exit 1; }
echo 'Source asset metadata verified.'
