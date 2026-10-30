#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu

REPO="kenzok8/openwrt-honk"
# 取最近 30 个 release 再过滤，而不是 /releases?per_page=1 或 /releases/latest：
# 前者会抓到 CI 的 source-*/candidate-* 预发布（只有源码包、没有安装包），
# 后者在全部为预发布时返回 404。这里只要非预发布、且 tag 形如 v2026.xx… 的正式版。
GH_API_LIST="https://api.github.com/repos/${REPO}/releases?per_page=30"
GH_API_TAG="https://api.github.com/repos/${REPO}/releases/tags"
GH_PROXY="${GH_PROXY:-https://ghfast.top/}"
GEO_FEED="https://down.dllkids.xyz/openwrt-feed"
TMP_DIR="/tmp/honk-install"

fetch_text() {
	url="$1"
	if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 --max-time 30 "$url" 2>/dev/null; else wget -qO- "$url" 2>/dev/null; fi
}

download_file() {
	url="$1"; out="$2"
	# Note: --allow-untrusted is used at install time because these packages are
	# built in CI and signed with an ephemeral key the device does not trust.
	# Downloads go through a proxy by default; retry to survive flaky networks.
	if command -v curl >/dev/null 2>&1; then curl -fL --connect-timeout 10 --max-time 300 --retry 5 --retry-delay 10 --retry-all-errors "$url" -o "$out"; else wget -qO "$out" "$url"; fi
}

proxy_url() {
	case "$1" in
		https://github.com/*) printf '%s%s\n' "$GH_PROXY" "$1" ;;
		*) printf '%s\n' "$1" ;;
	esac
}

# 先走镜像，失败再直连 GitHub：镜像（ghfast 之类的加速站）经常抖，
# 单次尝试会让用户以为"脚本坏了"。
download_github() {
	_dl_url="$1"; _dl_out="$2"
	if download_file "$(proxy_url "$_dl_url")" "$_dl_out"; then
		return 0
	fi
	if [ -n "$GH_PROXY" ]; then
		echo "镜像下载失败，改用直连 GitHub 重试" >&2
		download_file "$_dl_url" "$_dl_out"
		return $?
	fi
	return 1
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

geodata_installed() {
	[ -s /usr/share/v2ray/geoip.dat ] && [ -s /usr/share/v2ray/geosite.dat ] || return 1
	if [ "$PM" = apk ]; then
		apk info -e v2ray-geoip >/dev/null 2>&1 && apk info -e v2ray-geosite >/dev/null 2>&1
	else
		opkg list-installed v2ray-geoip | grep -q '^v2ray-geoip - ' &&
			opkg list-installed v2ray-geosite | grep -q '^v2ray-geosite - '
	fi
}

apk_file_version() {
	metadata="$(apk --allow-untrusted adbdump "$1")" || return 1
	name="$(printf '%s\n' "$metadata" | sed -n 's/^  name: //p' | head -n 1)"
	version="$(printf '%s\n' "$metadata" | sed -n 's/^  version: //p' | head -n 1)"
	[ "$name" = "$2" ] && [ -n "$version" ] || return 1
	printf '%s\n' "$version"
}

apk_installed_version() {
	apk list --installed "$1" | awk -v expected="$1-$2" '$1 == expected { found = 1 } END { exit !found }'
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

	release_list="$(fetch_text "$GH_API_LIST")"
	[ -n "$release_list" ] || { echo "无法获取 Release 列表。" >&2; exit 1; }

	# 从列表里挑第一个正式版：非预发布，且 tag 形如 v2026.xx…。
	# 不用 jq（设备上不一定有），只用 awk 按 tag_name/prerelease 配对挑。
	stable_tag="$(printf '%s' "$release_list" | awk '
		/"tag_name":/ { line=$0; sub(/^.*"tag_name": *"/, "", line); sub(/".*$/, "", line);
		                tag = (line ~ /^v[0-9][0-9][0-9][0-9]\./) ? line : "" }
		tag != "" && /"prerelease":/ { if ($0 ~ /:[[:space:]]*false/) { print tag; exit }; tag = "" }
	')"
	[ -n "$stable_tag" ] || { echo "未找到正式版 Release（最近 30 个全是预发布）。" >&2; exit 1; }
	echo "使用正式版：$stable_tag"

	release_json="$(fetch_text "$GH_API_TAG/$stable_tag")"
	[ -n "$release_json" ] || { echo "无法获取 Release $stable_tag 的信息。" >&2; exit 1; }

	# 从 release assets 里挑出本机架构的 honk 与 luci-app-honk。
	# 注意：honk 模式必须排除 luci-app-honk，否则 head -n 1 可能抓错包。
	honk_asset="$(printf '%s' "$release_json" | grep -oE "\"browser_download_url\": *\"[^\"]*honk[^\"]*${ARCH}\.${EXT}\"" | grep -v "luci-app-honk" | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)"
	# luci 是 noarch，但 APK 资产仍带架构后缀；优先取本机架构，其次任意一个。
	luci_asset="$(printf '%s' "$release_json" | grep -oE "\"browser_download_url\": *\"[^\"]*luci-app-honk[^\"]*${ARCH}\.${EXT}\"" | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)"
	if [ -z "$luci_asset" ]; then
		# IPK 是 _all.ipk，或其它架构的 noarch APK。
		luci_asset="$(printf '%s' "$release_json" | grep -oE "\"browser_download_url\": *\"[^\"]*luci-app-honk[^\"]*\.${EXT}\"" | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)"
	fi

	if [ -z "$honk_asset" ] && [ "$PM" = apk ]; then
		alt="$(fallback_arch "$ARCH" || true)"
		if [ -n "$alt" ]; then
			echo "架构 $ARCH 无独立包，回退到 $alt。"
			honk_asset="$(printf '%s' "$release_json" | grep -oE "\"browser_download_url\": *\"[^\"]*honk[^\"]*${alt}\.apk\"" | grep -v "luci-app-honk" | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)"
		fi
	fi

	[ -n "$honk_asset" ] || { echo "未找到 $ARCH 的 honk 包。" >&2; exit 1; }
	[ -n "$luci_asset" ] || { echo "未找到 luci-app-honk 包。" >&2; exit 1; }

	mkdir -p "$TMP_DIR"
	honk_file="$TMP_DIR/$(basename "$honk_asset")"
	luci_file="$TMP_DIR/$(basename "$luci_asset")"

	echo "下载 $honk_asset"
	download_github "$honk_asset" "$honk_file"
	echo "下载 $luci_asset"
	download_github "$luci_asset" "$luci_file"

	set -- "$honk_file" "$luci_file"
	if geodata_installed; then
		echo "复用已安装的 v2ray-geoip/geosite 数据。"
	else
		geo_dir="$GEO_FEED/$SDK/$ARCH"
		geo_listing="$(fetch_text "$geo_dir/" || true)"
		for pkg in v2ray-geoip v2ray-geosite; do
			if [ "$PM" = apk ]; then
				geo_name="$(printf '%s\n' "$geo_listing" | grep -oE "${pkg}-[0-9][^\"/<]*\\.apk" | head -n 1)"
			else
				geo_name="$(printf '%s\n' "$geo_listing" | grep -oE "${pkg}_[^\"/<]*_all\\.ipk" | head -n 1)"
			fi
			if [ -z "$geo_name" ]; then
				echo "未找到 $pkg 的 $SDK/$ARCH 安装包，将尝试设备现有软件源。" >&2
				continue
			fi
			geo_file="$TMP_DIR/$geo_name"
			echo "下载 $geo_dir/$geo_name"
			if download_file "$geo_dir/$geo_name" "$geo_file"; then
				if [ "$PM" = apk ]; then apk --allow-untrusted verify "$geo_file" || exit 1; fi
				set -- "$@" "$geo_file"
			else
				echo "$pkg 下载失败，将尝试设备现有软件源。" >&2
			fi
		done
	fi

	echo "安装 honk、luci-app-honk 及所需 geo 数据"
	if [ "$PM" = apk ]; then
		apk --allow-untrusted verify "$honk_file" "$luci_file" || exit 1
		honk_version="$(apk_file_version "$honk_file" honk)" || exit 1
		luci_version="$(apk_file_version "$luci_file" luci-app-honk)" || exit 1
		install_rc=0
		install_output="$(apk add --allow-untrusted "$@" 2>&1)" || install_rc=$?
		printf '%s\n' "$install_output"
	else
		opkg install "$@"
	fi

	if [ "$PM" = apk ]; then
		apk_installed_version honk "$honk_version" && apk_installed_version luci-app-honk "$luci_version" || {
			echo "apk 安装失败：目标版本未全部装入（退出码 $install_rc）。" >&2
			exit 1
		}
		if [ "$install_rc" -ne 0 ] && printf '%s\n' "$install_output" | grep -q '^ERROR:'; then
			echo "apk 安装脚本或依赖报错（退出码 $install_rc），请检查上方错误。" >&2
			exit "$install_rc"
		fi
	fi
	[ -x /usr/bin/honk-core ] && /usr/bin/honk-core --version >/dev/null 2>&1 &&
		[ -x /etc/init.d/honk ] && [ -x /usr/libexec/rpcd/honk ] &&
		[ -s /usr/share/doona/index.html ] &&
		[ -s /www/luci-static/resources/view/honk/overview.js ] &&
		jsonfilter -i /usr/share/rpcd/acl.d/luci-app-honk.json -e '@' >/dev/null 2>&1 &&
		jsonfilter -i /usr/share/luci/menu.d/luci-app-honk.json -e '@' >/dev/null 2>&1 || {
			echo "安装后 Honk 或 LuCI 关键文件缺失或无效。" >&2
			exit 1
		}
	geodata_installed || { echo "安装后缺少 v2ray-geoip/geosite 数据。" >&2; exit 1; }
	if [ "$PM" = apk ] && [ "$install_rc" -ne 0 ]; then
		echo "目标包已核对安装完成；但 apk 仍报告 $install_rc 个错误，请另行检查设备的包管理器状态。" >&2
	fi

	echo "完成。"
}

main "$@"
