#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# 打印当前包版本对应的发布 tag；同日多版靠包版本区分，不用 run ID。
set -eu

honk_version=$(sed -n 's/^PKG_VERSION:=//p' honk/Makefile)
luci_version=$(sed -n 's/^PKG_VERSION:=//p' luci-app-honk/Makefile)
[ -n "$honk_version" ] || { echo "cannot read honk PKG_VERSION" >&2; exit 1; }

tag="v$honk_version"
if [ -n "$luci_version" ]; then
	[ "$(printf '%s\n%s\n' "$tag" "v$luci_version" | sort -V | tail -n 1)" = "$tag" ] || tag="v$luci_version"
fi
printf '%s\n' "$tag"
