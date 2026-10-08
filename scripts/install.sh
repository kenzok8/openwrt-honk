#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu

REPO="kenzok8/openwrt-honk"
GH_API="https://api.github.com/repos/${REPO}/releases/latest"
GH_PROXY="${GH_PROXY:-https://ghfast.top/}"
WALL_FEED="src-git wall https://github.com/kenzok8/wall"
TMP_DIR="/tmp/honk-install"

fetch_text() {
	url="$1"
	if command -v curl >/dev/null 2>&1; then curl -fsSL "$url" 2>/dev/null; else wget -qO- "$url" 2>/dev/null; fi
}

download_file() {
	url="$1"; out="$2"
	if command -v curl >/dev/null 2>&1; then curl -fL "$url" -o "$out"; else wget -qO "$out" "$url"; fi
}

proxy_url() {
	case "$1" in
		https://github.com/*) printf '%s%s\n' "$GH_PROXY" "$1" ;;
		*) printf '%s\n' "$1" ;;
	esac
}

detect_sdk() {
	[ -r /etc/openwrt_release ] || return 1
	release="$(sed -n "s/^DISTRIB_RELEASE=['\"]\([^'\"]*\)['\"].*/\1/p" /etc/openwrt_release | head -n 1)"
	printf '%s\n' "$release" | grep -Eo '[0-9]+\.[0-9]+' | head -n 1
}

detect_manager() {
	sdk="$(detect_sdk || true)"
	case "$sdk" in
		2[5-9].*|[3-9][0-9].*)
			if command -v apk >/dev/null 2>&1; then echo apk; return; fi ;;
	esac
	if command -v opkg >/dev/null 2>&1; then echo opkg; return; fi
	if command -v apk >/dev/null 2>&1; then echo apk; return; fi
	echo unsupported
}

detect_arch() {
	pm="$1"
	if [ "$pm" = opkg ]; then
		opkg print-architecture | awk '/^arch / {print $2}' | tail -n 1
		return
	fi
	sed -n "s/^DISTRIB_ARCH=['\"]\([^'\"]*\)['\"].*/\1/p" /etc/openwrt_release 2>/dev/null | head -n 1
}

fallback_arch() {
	case "$1" in
		aarch64_generic) return 1 ;;
		aarch64_*) printf 'aarch64_generic\n' ;;
		*) return 1 ;;
	esac
}

main() {
	PM="$(detect_manager)"
	[ "$PM" = unsupported ] && { echo "无法识别包管理器（opkg/apk）。" >&2; exit 1; }

	ARCH="$(detect_arch "$PM")"
	[ -n "$ARCH" ] || { echo "无法识别架构。" >&2; exit 1; }

	SDK="$(detect_sdk || true)"
	[ -n "$SDK" ] || SDK="24.10"

	if [ "$PM" = apk ]; then
		EXT=apk
	else
		EXT=ipk
	fi

	echo "检测到：架构 $ARCH · SDK $SDK · $PM"

	release_json="$(fetch_text "$GH_API")"
	[ -n "$release_json" ] || { echo "无法获取最新 Release 信息。" >&2; exit 1; }

	# 从 release assets 里挑出本机架构的 honk 与 luci-app-honk。
	honk_asset="$(printf '%s' "$release_json" | grep -oE "\"browser_download_url\": *\"[^\"]*honk[^\"]*${ARCH}\.${EXT}\"" | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)"
	luci_asset="$(printf '%s' "$release_json" | grep -oE "\"browser_download_url\": *\"[^\"]*luci-app-honk[^\"]*\.${EXT}\"" | grep -v "_${ARCH}" | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)"
	if [ -z "$luci_asset" ]; then
		# noarch APK 不带架构后缀；IPK 是 _all.ipk。
		luci_asset="$(printf '%s' "$release_json" | grep -oE "\"browser_download_url\": *\"[^\"]*luci-app-honk[^\"]*\.${EXT}\"" | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)"
	fi

	if [ -z "$honk_asset" ] && [ "$PM" = apk ]; then
		alt="$(fallback_arch "$ARCH" || true)"
		if [ -n "$alt" ]; then
			echo "架构 $ARCH 无独立包，回退到 $alt。"
			honk_asset="$(printf '%s' "$release_json" | grep -oE "\"browser_download_url\": *\"[^\"]*honk[^\"]*${alt}\.apk\"" | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)"
		fi
	fi

	[ -n "$honk_asset" ] || { echo "未找到 $ARCH 的 honk 包。" >&2; exit 1; }
	[ -n "$luci_asset" ] || { echo "未找到 luci-app-honk 包。" >&2; exit 1; }

	# 确保 wall feed（v2ray-geoip/geosite 依赖来源）已配置。
	if ! grep -qF "kenzok8/wall" /etc/opkg/customfeeds.conf /etc/apk/repositories 2>/dev/null; then
		echo "未检测到 wall 源，v2ray-geoip/geosite 依赖可能无法解析。"
		echo "请先添加：$WALL_FEED"
	fi

	mkdir -p "$TMP_DIR"
	honk_file="$TMP_DIR/$(basename "$honk_asset")"
	luci_file="$TMP_DIR/$(basename "$luci_asset")"

	echo "下载 $honk_asset"
	download_file "$(proxy_url "$honk_asset")" "$honk_file"
	echo "下载 $luci_asset"
	download_file "$(proxy_url "$luci_asset")" "$luci_file"

	echo "安装 $honk_file"
	if [ "$PM" = apk ]; then
		apk add --allow-untrusted "$honk_file"
	else
		opkg install "$honk_file"
	fi

	echo "安装 $luci_file"
	if [ "$PM" = apk ]; then
		apk add --allow-untrusted "$luci_file"
	else
		opkg install "$luci_file"
	fi

	echo "完成。"
}

main "$@"
