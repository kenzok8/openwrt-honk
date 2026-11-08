#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Manually advance the pinned honk-core revision to upstream main.
# The per-architecture tarballs and hashes are produced by the release workflow's
# ci/build-core.sh, so this script only moves the source pin and bumps the version.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
. "$REPO_DIR/ci/pins.env"

UPSTREAM="${HONK_UPSTREAM_REPO:-$CORE_REPOSITORY}"
BRANCH="${HONK_UPSTREAM_BRANCH:-$CORE_BRANCH}"

command -v git >/dev/null 2>&1 || { echo "error: git is required" >&2; exit 1; }

core_new="$(git ls-remote "$UPSTREAM" "refs/heads/$BRANCH" | cut -f1)"
if ! [[ "$core_new" =~ ^[0-9a-f]{40}$ ]]; then
	echo "error: cannot resolve $BRANCH head from $UPSTREAM" >&2
	exit 1
fi

if [ "$core_new" = "$CORE_COMMIT" ]; then
	echo "No upstream change: already at $CORE_COMMIT"
	exit 0
fi

# 程序版本 = YYYY.MM.DD；同一天再出程序版本递增第四段，避免把 2026.11.08.2 覆盖成
# 2026.11.08 造成版本回退。
today="$(TZ=Asia/Shanghai date +%Y.%m.%d)"
current="$(sed -n 's/^PKG_VERSION:=//p' "$REPO_DIR/honk/Makefile")"
case "$current" in
	"$today") version="$today.1" ;;
	"$today".*)
		counter=${current#"$today".}
		case "$counter" in ''|*[!0-9]*) echo "error: invalid PKG_VERSION $current" >&2; exit 1 ;; esac
		version="$today.$((counter + 1))"
		;;
	*) version="$today" ;;
esac

echo "Advancing core pin:"
echo "  $(printf '%s' "$CORE_COMMIT" | cut -c1-7) -> $(printf '%s' "$core_new" | cut -c1-7)"
echo "  PKG_VERSION -> $version"

sed -i "s|^CORE_COMMIT=.*|CORE_COMMIT=$core_new|" "$REPO_DIR/ci/pins.env"
sed -i "s|^CORE_COMMIT:=.*|CORE_COMMIT:=$core_new|" "$REPO_DIR/honk/Makefile"
sed -i "s|^PKG_VERSION:=.*|PKG_VERSION:=$version|" "$REPO_DIR/honk/Makefile"
sed -i "s|^PKG_RELEASE:=.*|PKG_RELEASE:=1|" "$REPO_DIR/honk/Makefile"

echo "Done. Run the release workflow to build the multi-arch tarballs and publish."
