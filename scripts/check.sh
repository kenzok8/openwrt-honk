#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
for tool in bash sh node sha256sum git tar; do
	command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

for script in ci/build-core.sh ci/build-doona.sh ci/build-sdk.sh ci/create-release-feed.sh scripts/check.sh; do
	bash -n "$script"
done
for script in honk/files/*.sh luci-app-honk/root/usr/libexec/rpcd/honk luci-app-honk/root/usr/share/luci-app-honk/*.sh; do
	sh -n "$script"
done
sh -n honk/files/honk.init
sh -n honk/files/90-honk-boot
for file in luci-app-honk/htdocs/luci-static/resources/view/honk/{rpc,overview,settings,dashboard,configuration,logs,maintenance,sha256,converter}.js; do
	node --check "$file"
done
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' luci-app-honk/root/usr/share/luci/menu.d/luci-app-honk.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' luci-app-honk/root/usr/share/rpcd/acl.d/luci-app-honk.json

grep -q '^CORE_COMMIT=[0-9a-f]\{40\}$' ci/pins.env
grep -q '^DOONA_COMMIT=[0-9a-f]\{40\}$' ci/pins.env
grep -q '^DOONA_PATCH_SHA256=[0-9a-f]\{64\}$' ci/pins.env
grep -q '^OPENWRT_SDK_SHA256=[0-9a-f]\{64\}$' ci/pins.env
grep -q '^BPF_LINKER_SHA256=[0-9a-f]\{64\}$' ci/pins.env
test "$(sha256sum ci/patches/doona-openwrt.patch | cut -d' ' -f1)" = "$(sed -n 's/^DOONA_PATCH_SHA256=//p' ci/pins.env)"
source ci/pins.env

node <<'NODE'
const fs = require('fs');
const lines = fs.readFileSync('ci/patches/doona-openwrt.patch', 'utf8').split('\n');
const badAdditions = lines.filter(line => line.startsWith('+') && !line.startsWith('+++') && /[\t ]+$/.test(line.slice(1)));
if (badAdditions.length)
	throw new Error(`Patch contains added lines with trailing whitespace (${badAdditions.length})`);
const whitespaceContext = lines.filter(line => /^[\t ]+$/.test(line));
if (whitespaceContext.some(line => line !== ' '))
	throw new Error('Unified-diff context lines must be a single space');
NODE

verify_stage() {
	local makefile=$1 archive=$2 checksum expected
	test -f "$makefile" || return 0
	checksum=$(sed -n 's/^PKG_HASH:=//p' "$makefile")
	test "${#checksum}" -eq 64 || { echo "Invalid stage hash in $makefile" >&2; exit 1; }
	if test -s "artifacts/cache/$archive"; then
		expected=$(sha256sum "artifacts/cache/$archive" | cut -d' ' -f1)
		test "$checksum" = "$expected" || { echo "Staged archive hash mismatch: $archive" >&2; exit 1; }
	fi
}
verify_stage luci-app-honk/generated-doona-stage.mk "$DOONA_ARCHIVE"
verify_stage honk/generated-stage.mk "$CORE_ARCHIVE"
if test -f honk/generated-provenance.json; then
	node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' honk/generated-provenance.json
fi

node <<'NODE'
const fs = require('fs');
const rpcSource = fs.readFileSync('luci-app-honk/htdocs/luci-static/resources/view/honk/rpc.js', 'utf8');
const backend = fs.readFileSync('luci-app-honk/root/usr/libexec/rpcd/honk', 'utf8');
const acl = JSON.parse(fs.readFileSync('luci-app-honk/root/usr/share/rpcd/acl.d/luci-app-honk.json', 'utf8'))['luci-app-honk'];
const expected = ['status', 'check', 'initialize', 'start', 'stop', 'restart', 'settings', 'repair', 'backup', 'restore', 'restore_prepare', 'reset', 'job_status', 'logs', 'update_check', 'update_apply'];
const frontend = [...rpcSource.matchAll(/method:\s*'([^']+)'/g)].map(match => match[1]);
const list = backend.match(/echo '([^']+)'/);
if (!list) throw new Error('RPC backend has no list method declaration');
const declared = Object.keys(JSON.parse(list[1]));
const aclMethods = [...(acl.read.ubus.honk || []), ...(acl.write.ubus.honk || [])].sort();
for (const [label, methods] of [['frontend', frontend], ['backend list', declared], ['ACL', aclMethods]]) {
	if (JSON.stringify([...methods].sort()) !== JSON.stringify([...expected].sort()))
		throw new Error(`${label} RPC methods do not match the required method set: ${methods.join(', ')}`);
}
for (const method of expected) {
	const block = backend.match(new RegExp(`\\n\\s*${method}\\)\\n([\\s\\S]*?)\\n\\s*;;`));
	if (!block || !block[1].trim() || /unknown_method/.test(block[1]))
		throw new Error(`RPC method ${method} has no concrete backend case`);
}
if (!/params:\s*\[\s*'lan_network',\s*'listen_port',\s*'boot_enabled'\s*\]/.test(rpcSource))
	throw new Error('settings RPC parameters do not include boot_enabled');
NODE

redacted=$(printf '%s\n' \
	'Authorization: Bearer HONK_BEARER_SECRET_7c2a' \
	'{"password": "HONK_PASSWORD_SECRET PW_TAIL_unique"}' \
	'subscription=https://user:HONK_URL_SECRET@example.invalid/feed?token=HONK_QUERY_SECRET' \
	'vmess://HONK_SHARELINK_SECRET' | sh honk/files/redact-log.sh)
case "$redacted" in
	*HONK_BEARER_SECRET_7c2a*|*HONK_PASSWORD_SECRET*|*PW_TAIL_unique*|*HONK_URL_SECRET*|*HONK_QUERY_SECRET*|*HONK_SHARELINK_SECRET*)
		echo 'Log redaction leaked a test secret.' >&2
		exit 1
		;;
esac

. honk/files/log-lines.sh
log_lines_added=0
json_add_string() { log_lines_added=$((log_lines_added + 1)); }
empty_log=$(mktemp)
honk_add_log_lines "$empty_log"
test "$log_lines_added" -eq 0
printf 'kept\n' > "$empty_log"
honk_add_log_lines "$empty_log"
rm -f "$empty_log"
test "$log_lines_added" -eq 1

log_fixture=$(mktemp)
printf '%s\n' \
	'Mon Oct  5 10:00:00 2026 daemon.info honk-core[11]: proxy text contains [ERROR]' \
	'Mon Oct  5 10:00:01 2026 daemon.err honk-core[11]: request failed' \
	'Mon Oct  5 10:00:02 2026 daemon.info honk-core[11]: WARN candidate check' \
	'Mon Oct  5 10:00:03 2026 daemon.debug honk-core[11]: debug detail' > "$log_fixture"
error_logs=$(sh honk/files/log-level-filter.sh error < "$log_fixture")
warn_logs=$(sh honk/files/log-level-filter.sh warn < "$log_fixture")
info_logs=$(sh honk/files/log-level-filter.sh info < "$log_fixture")
rm -f "$log_fixture"
case "$error_logs" in *'request failed'*) ;; *) echo 'Syslog error severity was not recognized.' >&2; exit 1 ;; esac
case "$error_logs" in *'proxy text contains'*|*'WARN candidate'*) echo 'Log body text was misclassified as error.' >&2; exit 1 ;; esac
case "$warn_logs" in *'WARN candidate check'*) ;; *) echo 'Core warning prefix was not recognized.' >&2; exit 1 ;; esac
case "$info_logs" in *'proxy text contains [ERROR]'*|*'request failed'*|*'WARN candidate check'*) ;; *) echo 'Info severity filter dropped expected log rows.' >&2; exit 1 ;; esac
case "$info_logs" in *'debug detail'*) echo 'Info severity filter included debug logs.' >&2; exit 1 ;; esac

reset_fixture=$(mktemp -d)
mkdir -p "$reset_fixture/old/etc/honk/state" "$reset_fixture/new"
printf 'include { extra.dae }\n' > "$reset_fixture/old/etc/honk/config.dae"
printf 'node { name: old }\n' > "$reset_fixture/old/etc/honk/extra.dae"
printf 'administrator-preserved\n' > "$reset_fixture/old/etc/honk/state/honk.db"
printf 'system config\n' > "$reset_fixture/system.dae"
printf 'default config\n' > "$reset_fixture/default.dae"
check_path=$PATH
export HONK_MAINT_LIBRARY=1
. honk/files/maintenance.sh
unset HONK_MAINT_LIBRARY
PATH=$check_path
export PATH
stage_reset_tree "$reset_fixture/old/etc/honk" "$reset_fixture/new/etc/honk" "$reset_fixture/system.dae" "$reset_fixture/default.dae"
test "$(cat "$reset_fixture/new/etc/honk/config.dae")" = 'default config'
test "$(cat "$reset_fixture/new/etc/honk/system.dae")" = 'system config'
test "$(cat "$reset_fixture/new/etc/honk/state/honk.db")" = 'administrator-preserved'
test ! -e "$reset_fixture/new/etc/honk/extra.dae"
rm -rf "$reset_fixture"

node <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const sha256Source = fs.readFileSync('luci-app-honk/htdocs/luci-static/resources/view/honk/sha256.js', 'utf8')
	.replace(/return baseclass\.extend\(\{ sha256: sha256 \}\);/, 'return sha256;');
const sha256 = new Function(sha256Source)();
for (const input of [Buffer.alloc(0), Buffer.from('abc'), Buffer.alloc(2 * 1024 * 1024, 0x5a)]) {
	const actual = sha256(input);
	const expected = crypto.createHash('sha256').update(input).digest('hex');
	if (actual !== expected)
		throw new Error(`Pure JavaScript SHA-256 mismatch for ${input.length} bytes`);
}
NODE

grep -Fq 'include $(INCLUDE_DIR)/package.mk' luci-app-honk/Makefile
grep -Fq '$(eval $(call BuildPackage,luci-app-honk))' luci-app-honk/Makefile
! grep -Fq 'include $(TOPDIR)/feeds/luci/luci.mk' luci-app-honk/Makefile
grep -Fq 'PKG_BUILD_DEPENDS:=luci-base/host' luci-app-honk/Makefile
grep -Fq 'po2lmo ./po/zh-cn/honk.po' luci-app-honk/Makefile
grep -Fq '$(INSTALL_DATA) $(PKG_BUILD_DIR)/honk.zh-cn.lmo' luci-app-honk/Makefile
grep -Fq 'view/honk/vendor' luci-app-honk/Makefile
grep -Fq '"/tmp/honk-maintenance/restore.tar.gz": [ "write" ]' luci-app-honk/root/usr/share/rpcd/acl.d/luci-app-honk.json

grep -Fq 'include $(CURDIR)/generated-stage.mk' honk/Makefile
grep -Fq 'test -s $(CURDIR)/generated-provenance.json' honk/Makefile
grep -Fq '$(INSTALL_BIN) $(CURDIR)/files/update.sh' honk/Makefile
grep -Fq 'install -m 0644 "$ROOT/ci/pins.env" "$SDK_DIR/package/ci/pins.env"' ci/build-sdk.sh
grep -Fq 'CONFIG_PACKAGE_honk=m' ci/build-sdk.sh
grep -Fq 'CONFIG_PACKAGE_luci-app-honk=m' ci/build-sdk.sh
! grep -Fq 'CONFIG_PACKAGE_luci-i18n-honk-zh-cn=m' ci/build-sdk.sh
grep -Fq 'CONFIG_PACKAGE_v2ray-geoip=m' ci/build-sdk.sh
grep -Fq 'CONFIG_PACKAGE_v2ray-geosite=m' ci/build-sdk.sh
! grep -Fq './scripts/config' ci/build-sdk.sh
grep -Fq 'export HONK_SDK_PACKAGE' ci/build-sdk.sh

grep -Fq 'src-git --root=package base https://git.openwrt.org/openwrt/openwrt.git^ba915c2ee711d047d5be8575c1e98699119429ab' ci/build-sdk.sh
grep -Fq './scripts/feeds update base packages luci' ci/build-sdk.sh
grep -Fq './scripts/feeds install -f -p base zlib libubox ubus uci libnl-tiny iwinfo lua ucode libjson-c libmd' ci/build-sdk.sh
grep -Fq './scripts/feeds install -p packages luasrcdiet' ci/build-sdk.sh
grep -Fq 'package/feeds/luci/luci-base/host/compile' ci/build-sdk.sh
grep -Fq 'package/v2ray-geodata/compile' ci/build-sdk.sh
grep -Fq 'package/feeds/luci/lucihttp/compile V=s' ci/build-sdk.sh
grep -Fq "'adbdump'" ci/create-release-feed.sh
grep -Fq ' -V -m "$STAGE/manifest.json" -p "$MANIFEST_PUBLIC_KEY"' ci/create-release-feed.sh
grep -Fq "extract', '--destination'" ci/create-release-feed.sh
grep -Fq 'Generated core provenance does not match the pinned source.' ci/create-release-feed.sh
grep -Fq "'usr/share/honk/provenance.json'" ci/create-release-feed.sh
grep -Fq "'usr/bin/honk-core'" ci/create-release-feed.sh
grep -Fq 'packages/Packages.adb' ci/create-release-feed.sh
grep -Fq 'apk-tool' ci/create-release-feed.sh
grep -Fq 'HONK_BTF_BUILD_DEPENDS:=+@KERNEL_DEBUG_INFO_BTF' honk/Makefile
grep -Fq '"sdk_btf_verified": false' ci/build-core.sh
grep -Fq "! rg -n 'MockBackend|mockBackend|mock-backend' dist" ci/build-doona.sh
! grep -Fq "! rg -n 'mock backend|MockBackend|mockBackend' dist" ci/build-doona.sh
grep -Fq 'node tools/notices.mjs "$STAGE"' ci/build-doona.sh
grep -Fq 'for file in LICENSE NOTICE CHANGELOG.md README.md; do' ci/build-doona.sh
grep -Fq 'PKG_HASH:=d5725cad5b30df11c5886480dfcd3860e9ab61935583ef3a8465c15b4df97481' luci-app-honk/Makefile

grep -Fq 'start_job update_check' luci-app-honk/root/usr/libexec/rpcd/honk
grep -Fq 'update_gate' luci-app-honk/root/usr/libexec/rpcd/honk
grep -Fq 'trap cleanup_update EXIT' honk/files/update.sh
grep -Fq 'UPDATE_LOCK_OWNED=1' honk/files/update.sh
grep -Fq 'checking_feed' honk/files/job.sh


grep -Fq "honk.settings(networkSelect.value, port, bootEnabledInput.checked)" luci-app-honk/htdocs/luci-static/resources/view/honk/overview.js

git diff --check
echo 'Static checks passed.'
