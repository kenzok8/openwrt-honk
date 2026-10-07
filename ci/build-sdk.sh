#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/ci/pins.env"
if test "$(uname -s)" != Linux || test "$(uname -m)" != x86_64; then
	echo 'The pinned OpenWrt SDK build requires Linux x86_64.' >&2
	exit 1
fi
CACHE_DIR=${HONK_CACHE_DIR:-"$ROOT/artifacts/cache"}
WORK_DIR=${HONK_WORK_DIR:-"$ROOT/.cache/sdk-work"}
OUT_DIR=${HONK_OUTPUT_DIR:-"$ROOT/artifacts/apk"}
mkdir -p "$CACHE_DIR" "$(dirname "$WORK_DIR")" "$OUT_DIR"
for tool in curl sha256sum tar zstd make find node; do
	command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
test -f "$ROOT/honk/generated-stage.mk" || { echo 'Run ci/build-core.sh first.' >&2; exit 1; }
test -f "$ROOT/luci-app-honk/generated-doona-stage.mk" || { echo 'Run ci/build-doona.sh first.' >&2; exit 1; }

SDK_ARCHIVE_PATH="$CACHE_DIR/$OPENWRT_SDK_ARCHIVE"
if ! test -s "$SDK_ARCHIVE_PATH"; then
	curl -fL "$OPENWRT_SDK_URL" -o "$SDK_ARCHIVE_PATH"
fi
test "$(sha256sum "$SDK_ARCHIVE_PATH" | cut -d' ' -f1)" = "$OPENWRT_SDK_SHA256" || { echo 'OpenWrt SDK SHA256 mismatch.' >&2; exit 1; }
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
tar --zstd -xf "$SDK_ARCHIVE_PATH" -C "$WORK_DIR"
SDK_DIR=$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d -name 'openwrt-sdk-*' -print -quit)
test -n "$SDK_DIR" || { echo 'Could not find extracted OpenWrt SDK.' >&2; exit 1; }

if test -n "${APK_SIGN_KEY:-}"; then
	test -f "$APK_SIGN_KEY" && test ! -L "$APK_SIGN_KEY" || { echo 'APK_SIGN_KEY must reference an existing regular key file.' >&2; exit 1; }
	export APK_SIGN_KEY
fi

mkdir -p "$SDK_DIR/package/honk" "$SDK_DIR/package/luci-app-honk" "$SDK_DIR/package/v2ray-geodata"
cp -a "$ROOT/honk/." "$SDK_DIR/package/honk/"
cp -a "$ROOT/luci-app-honk/." "$SDK_DIR/package/luci-app-honk/"
cp -a "$ROOT/v2ray-geodata/." "$SDK_DIR/package/v2ray-geodata/"
mkdir -p "$SDK_DIR/package/ci"
install -m 0644 "$ROOT/ci/pins.env" "$SDK_DIR/package/ci/pins.env"
mkdir -p "$SDK_DIR/dl"
install -m 0644 "$CACHE_DIR/$CORE_ARCHIVE" "$SDK_DIR/dl/$CORE_ARCHIVE"
install -m 0644 "$CACHE_DIR/$DOONA_ARCHIVE" "$SDK_DIR/dl/$DOONA_ARCHIVE"

cd "$SDK_DIR"
PACK_RULE="$SDK_DIR/include/package-pack.mk"
test -f "$PACK_RULE" || { echo 'Pinned SDK package pack rule is missing.' >&2; exit 1; }
node - "$PACK_RULE" <<'NODE'
const fs = require('fs');
const filename = process.argv[2];
const source = fs.readFileSync(filename, 'utf8');
const needle = '--output "$$(PACK_$(1))"';
if (source.split(needle).length - 1 !== 1)
	throw new Error('Pinned SDK package pack rule changed; refusing an ambiguous signing edit.');
const signing = '$(if $(APK_SIGN_KEY),--sign-key "$(APK_SIGN_KEY)") ' + String.fromCharCode(92, 10);
fs.writeFileSync(filename, source.replace(needle, signing + needle), { mode: fs.statSync(filename).mode });
NODE
HONK_SDK_PACKAGE=1
export HONK_SDK_PACKAGE
if test -f feeds.conf.default; then
	sed -E '/^src-(git|svn|hg|bzr|link)[[:space:]]+([^[:space:]]+[[:space:]]+)*base([[:space:]]|$)/d' feeds.conf.default > feeds.conf
fi
printf '%s\n' 'src-git --root=package base https://git.openwrt.org/openwrt/openwrt.git^ba915c2ee711d047d5be8575c1e98699119429ab' >> feeds.conf
./scripts/feeds update base packages luci
./scripts/feeds install -f -p base zlib libubox ubus uci libnl-tiny iwinfo lua ucode libjson-c libmd
./scripts/feeds install -p packages luasrcdiet
./scripts/feeds install luci-base
cat >> .config <<'EOF'
CONFIG_PACKAGE_honk=m
CONFIG_PACKAGE_luci-app-honk=m
CONFIG_PACKAGE_v2ray-geoip=m
CONFIG_PACKAGE_v2ray-geosite=m
EOF
make defconfig
grep -qx 'CONFIG_PACKAGE_honk=m' .config || { echo 'The honk package is not selected; check its kernel BTF dependency.' >&2; exit 1; }
grep -qx 'CONFIG_PACKAGE_luci-app-honk=m' .config || { echo 'The LuCI app package is not selected.' >&2; exit 1; }
grep -qx 'CONFIG_PACKAGE_v2ray-geoip=m' .config || { echo 'The GeoIP data package is not selected.' >&2; exit 1; }
grep -qx 'CONFIG_PACKAGE_v2ray-geosite=m' .config || { echo 'The GeoSite data package is not selected.' >&2; exit 1; }

make -j1 package/feeds/luci/luci-base/host/compile package/feeds/luci/lucihttp/compile V=s
make -j1 package/honk/compile package/luci-app-honk/compile package/v2ray-geodata/compile V=s
find bin/packages -type f \( -name 'honk-*.apk' -o -name 'luci-app-honk-*.apk' \) -exec cp -v {} "$OUT_DIR/" \;
compgen -G "$OUT_DIR/honk-*.apk" >/dev/null || { echo 'Honk APK was not produced.' >&2; exit 1; }
compgen -G "$OUT_DIR/luci-app-honk-*.apk" >/dev/null || { echo 'LuCI APK was not produced.' >&2; exit 1; }
(cd "$OUT_DIR" && sha256sum honk-*.apk luci-app-honk-*.apk > SHA256SUMS)
printf 'APK artifacts are in %s\n' "$OUT_DIR"
