#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu

if command -v apk >/dev/null 2>&1; then
	apk del luci-app-honk honk 2>/dev/null || true
elif command -v opkg >/dev/null 2>&1; then
	opkg remove luci-app-honk honk 2>/dev/null || true
else
	echo "未找到包管理器（opkg/apk）。" >&2
	exit 1
fi

echo "已卸载 honk 与 luci-app-honk。"
