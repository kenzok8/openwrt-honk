#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
for tool in bash sh node sha256sum git tar; do
	command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

for script in ci/build-doona.sh scripts/check.sh scripts/verify-source-assets.sh; do
	bash -n "$script"
done
for script in honk/files/*.sh luci-app-honk/root/usr/libexec/rpcd/honk luci-app-honk/root/usr/share/luci-app-honk/*.sh; do
	sh -n "$script"
done
sh -n honk/files/honk.init
sh -n honk/files/90-honk-boot
for file in luci-app-honk/htdocs/luci-static/resources/view/honk/{rpc,overview,settings,dashboard,configuration,logs,maintenance,converter,sha256}.js; do
	node --check "$file"
done
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' luci-app-honk/root/usr/share/luci/menu.d/luci-app-honk.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' luci-app-honk/root/usr/share/rpcd/acl.d/luci-app-honk.json

# 核心跟随上游 daeuniverse/honk 的 main。曾经跟着一条 fork 的 feat/native-api
# 分支，那条分支冻结 11 天，pin 落后上游 111 个 commit 都没人察觉。
grep -q '^CORE_REPOSITORY=https://github.com/daeuniverse/honk.git$' ci/pins.env
grep -q '^CORE_BRANCH=main$' ci/pins.env
# 拼一下名字，免得 grep 扫到本文件里的字面量而误报。
fork_owner="Glassy""iris"
! grep -rIq "$fork_owner" --exclude-dir=.git --exclude-dir=.codegraph --exclude-dir=artifacts . || {
	echo 'honk-core must track upstream daeuniverse/honk, not a fork mirror' >&2
	exit 1
}
grep -q '^CORE_COMMIT=[0-9a-f]\{40\}$' ci/pins.env
grep -q '^DOONA_COMMIT=[0-9a-f]\{40\}$' ci/pins.env
grep -q '^DOONA_PATCH_SHA256=[0-9a-f]\{64\}$' ci/pins.env
grep -q '^OPENWRT_SDK_SHA256=[0-9a-f]\{64\}$' ci/pins.env
test "$(sha256sum ci/patches/doona-openwrt.patch | cut -d' ' -f1)" = "$(sed -n 's/^DOONA_PATCH_SHA256=//p' ci/pins.env)"
source ci/pins.env
test "$CORE_COMMIT" = "$(sed -n 's/^CORE_COMMIT:=//p' honk/Makefile)"
test "$DOONA_ARCHIVE" = "$(sed -n 's/^PKG_SOURCE:=//p' luci-app-honk/Makefile)"
grep -q '^PKG_HASH:=[0-9a-f]\{64\}$' luci-app-honk/Makefile

# Download metadata must be complete and immutable enough for a plain feed
# build, i.e. a build without honk/generated-stage.mk. Any missing hash or a
# mutable download location breaks everyone who compiles the feed themselves.
for makefile in honk/Makefile luci-app-honk/Makefile; do
	grep -q '^HONK_SOURCE_TAG?=source-[0-9A-Za-z._-]\+$' "$makefile" || {
		echo "$makefile: missing or malformed HONK_SOURCE_TAG" >&2
		exit 1
	}
	! grep -q 'releases/download/staging' "$makefile" || {
		echo "$makefile: download URL points at the mutable staging release" >&2
		exit 1
	}
done
test "$(sed -n 's/^HONK_SOURCE_TAG?=//p' honk/Makefile)" = \
	"$(sed -n 's/^HONK_SOURCE_TAG?=//p' luci-app-honk/Makefile)" || {
	echo 'honk and luci-app-honk must reference the same source tag' >&2
	exit 1
}
for arch in X86_64 AARCH64 ARMV7; do
	grep -q "^HONK_HASH_${arch}?=[0-9a-f]\{64\}$" honk/Makefile || {
		echo "honk/Makefile: HONK_HASH_${arch} is missing or not a SHA-256" >&2
		exit 1
	}
done
! grep -n 'SKIP' honk/Makefile luci-app-honk/Makefile || {
	echo 'package Makefiles must not fall back to a skipped hash' >&2
	exit 1
}

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
	test "$checksum" = "$(sed -n 's/^PKG_HASH:=//p' luci-app-honk/Makefile)" || {
		echo "Committed Doona hash differs from staged archive." >&2
		exit 1
	}
	if test -s "artifacts/cache/$archive"; then
		expected=$(sha256sum "artifacts/cache/$archive" | cut -d' ' -f1)
		test "$checksum" = "$expected" || { echo "Staged archive hash mismatch: $archive" >&2; exit 1; }
	fi
}
verify_stage luci-app-honk/generated-doona-stage.mk "$DOONA_ARCHIVE"

node <<'NODE'
const fs = require('fs');
const rpcSource = fs.readFileSync('luci-app-honk/htdocs/luci-static/resources/view/honk/rpc.js', 'utf8');
const backend = fs.readFileSync('luci-app-honk/root/usr/libexec/rpcd/honk', 'utf8');
const acl = JSON.parse(fs.readFileSync('luci-app-honk/root/usr/share/rpcd/acl.d/luci-app-honk.json', 'utf8'))['luci-app-honk'];
const expected = ['status', 'check', 'initialize', 'start', 'stop', 'restart', 'settings', 'add_subscription', 'probe_subscription', 'add_nodes', 'import_dae', 'config_read', 'config_draft_read', 'lan_candidates', 'config_validate', 'config_save', 'config_apply', 'config_use_managed', 'reset_admin', 'repair', 'backup', 'restore', 'restore_prepare', 'reset', 'job_status', 'logs', 'update_check', 'update_apply'];
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
if (!/params:\s*\[\s*'lan_network',\s*'listen_port',\s*'clash_api_enabled',\s*'clash_api_port',\s*'clash_api_secret'\s*\]/.test(rpcSource))
	throw new Error('settings RPC parameters do not include Clash API settings');
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
	'Mon Oct  5 10:00:02 2026 daemon.info honk-core[11]:  WARN candidate check' \
	'Mon Oct  5 10:00:03 2026 daemon.debug honk-core[11]: debug detail' > "$log_fixture"
error_logs=$(sh honk/files/log-level-filter.sh error < "$log_fixture")
warn_logs=$(sh honk/files/log-level-filter.sh warn < "$log_fixture")
info_logs=$(sh honk/files/log-level-filter.sh info < "$log_fixture")
rm -f "$log_fixture"
case "$error_logs" in *'request failed'*) ;; *) echo 'Syslog error severity was not recognized.' >&2; exit 1 ;; esac
case "$error_logs" in *'proxy text contains'*|*'WARN candidate'*) echo 'Log body text was misclassified as error.' >&2; exit 1 ;; esac
case "$warn_logs" in *'WARN candidate check'*) ;; *) echo 'Core warning prefix was not recognized.' >&2; exit 1 ;; esac
case "$warn_logs" in *'proxy text contains'*|*'debug detail'*) echo 'Warning severity filter included lower-level logs.' >&2; exit 1 ;; esac
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
test "$(ls -ld "$reset_fixture/new/etc/honk/system.dae" | awk '{print substr($1, 1, 10)}')" = '-rw-------'
test "$(cat "$reset_fixture/new/etc/honk/state/honk.db")" = 'administrator-preserved'
test ! -e "$reset_fixture/new/etc/honk/extra.dae"
rm -rf "$reset_fixture"

grep -Fq 'include $(INCLUDE_DIR)/package.mk' luci-app-honk/Makefile
grep -Fq '$(eval $(call BuildPackage,luci-app-honk))' luci-app-honk/Makefile
! grep -Fq 'include $(TOPDIR)/feeds/luci/luci.mk' luci-app-honk/Makefile
grep -Fq 'PKG_BUILD_DEPENDS:=luci-base/host' luci-app-honk/Makefile
grep -Fq 'po2lmo ./po/zh-cn/honk.po' luci-app-honk/Makefile
grep -Fq '$(INSTALL_DATA) $(PKG_BUILD_DIR)/honk.zh-cn.lmo' luci-app-honk/Makefile
grep -Fq 'view/honk/vendor' luci-app-honk/Makefile
node -e 'const acl=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))["luci-app-honk"]; if (!(acl.write.file["/tmp/honk-maintenance/restore.tar.gz"] || []).includes("write")) process.exit(1)' luci-app-honk/root/usr/share/rpcd/acl.d/luci-app-honk.json

grep -Fq 'HONK_ASSET_X86_64?=' honk/Makefile
grep -Fq 'HONK_ASSET_AARCH64?=' honk/Makefile
grep -Fq 'HONK_ASSET_ARMV7?=' honk/Makefile
grep -Fq '@(x86_64||aarch64||arm)' honk/Makefile
grep -Fq '$(INSTALL_BIN) $(CURDIR)/files/update.sh' honk/Makefile

grep -Fq '+@KERNEL_DEBUG_INFO_BTF' honk/Makefile
# libubox is packaged under an ABI-versioned name (libubox20260213), so listing it
# in DEPENDS pins the apk to one firmware ABI. The scripts only need jshn.sh, which
# the jshn package provides together with the device's own libubox.
if sed -n 's/^[[:space:]]*DEPENDS:=//p' honk/Makefile luci-app-honk/Makefile | grep -Fq '+libubox'; then
	echo 'DEPENDS must not name libubox directly; rely on jshn instead' >&2
	exit 1
fi
# honk-core 的 eBPF 数据面启动时硬校验 Linux 6.12+，所以只发 SDK 25.12（内核 6.12）；
# 24.10 的 6.6 内核装上也跑不起来，矩阵里不能再加回来。
grep -Fq '          - "25.12"' .github/workflows/release.yml
! grep -Fq '          - "24.10"' .github/workflows/release.yml || {
	echo 'release.yml must not build SDK 24.10 packages: honk needs kernel 6.12+' >&2
	exit 1
}
grep -Fq 'aarch64_cortex-a76' .github/workflows/release.yml
grep -Fq 'kernel_ok' scripts/install.sh
grep -Fq "! rg -n 'MockBackend|mockBackend|mock-backend' dist" ci/build-doona.sh
! grep -Fq "! rg -n 'mock backend|MockBackend|mockBackend' dist" ci/build-doona.sh
grep -Fq 'node tools/notices.mjs "$STAGE"' ci/build-doona.sh
grep -Fq 'for file in LICENSE NOTICE CHANGELOG.md README.md; do' ci/build-doona.sh
grep -Fq 'rm -rf "$STAGE/fonts" "$STAGE/.vite"' ci/build-doona.sh

grep -Fq 'start_job update_check' luci-app-honk/root/usr/libexec/rpcd/honk
grep -Fq 'update_gate' luci-app-honk/root/usr/libexec/rpcd/honk
grep -Fq 'trap cleanup_update EXIT' honk/files/update.sh
grep -Fq 'UPDATE_LOCK_OWNED=1' honk/files/update.sh
grep -Fq 'checking_feed' honk/files/job.sh


grep -Fq "honk.settings(networkSelect.value, port, clashEnabledInput.checked, clashPort, clashSecret)" luci-app-honk/htdocs/luci-static/resources/view/honk/overview.js

git diff --check
echo 'Static checks passed.'
