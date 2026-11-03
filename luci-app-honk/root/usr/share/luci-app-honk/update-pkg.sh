#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# update-pkg.sh <honk|luci-app-honk>
# Refresh, preflight and download before stopping the running service.
# The background result is streamed to /tmp/luci-app-honk.pkg.<name>.log.

PKG="$1"
case "$PKG" in
	honk|luci-app-honk) ;;
	*) echo "usage: $0 <honk|luci-app-honk>" >&2; exit 64 ;;
esac

# Upgrading luci-app-honk replaces this file. Finish from a private copy.
umask 077
case "$0" in
	/tmp/.honk-upd-*) ;;
	*)
		_self=$(mktemp /tmp/.honk-upd-XXXXXX) || exit 1
		cp "$0" "$_self" || { rm -f "$_self"; exit 1; }
		exec sh "$_self" "$@"
		;;
esac

LOG="/tmp/luci-app-honk.pkg-${PKG}.log"

# Hold the existing shared APK lock through download, installation and readiness.
# The background child inherits fd 9; concurrent requests cannot truncate its log.
exec 9>/tmp/luci-app-honk.apk.lock || { rm -f "$0"; exit 1; }
flock -n 9 || { echo "Honk package update already in progress" >&2; rm -f "$0"; exit 75; }

service_running() {
	honk_lifecycle_managed_pid >/dev/null 2>&1
}

restore_service_state() {
	if [ "$was_running" = 1 ]; then
		# OpenWrt's package post-install script may have started the new core.
		# Wait for that instance instead of stopping and starting it again.
		if service_running; then
			honk_lifecycle_wait_ready 30 || return $?
		else
			honk_lifecycle_start 30 || return $?
		fi
		echo "result: 服务已恢复运行"
	else
		honk_lifecycle_stop 30 || return $?
		echo "result: 服务保持停止"
	fi
}

upgrade_package() {
	command -v apk >/dev/null 2>&1 || { echo "no package manager found"; return 3; }
	[ -r /usr/share/honk/lifecycle.sh ] || return 1
	. /usr/share/honk/lifecycle.sh || return $?

	work_dir=$(mktemp -d /tmp/honk-pkg-XXXXXX) || return 1
	cache="$work_dir/cache"
	mkdir "$cache" || return $?
	apk --cache-dir "$cache" update || return $?
	available=$(apk --cache-dir "$cache" list --available "$PKG") || return $?
	ver=$(printf '%s\n' "$available" | awk -v p="$PKG" '$1 ~ "^" p "-[0-9]" { v=$1; sub("^" p "-", "", v); print v }' | sort -V | tail -1)
	[ -n "$ver" ] || { echo "result: 软件源中没有找到 $PKG"; return 1; }
	constraint="$PKG=$ver"

	echo "--- 预检并下载 $constraint ---"
	apk --cache-dir "$cache" add --simulate "$constraint" || return $?
	apk --cache-dir "$cache" cache download "$constraint" || return $?
	# Confirm the actual installation can finish without the proxy or network.
	apk --cache-dir "$cache" --no-network add --simulate "$constraint" || return $?

	was_running=0
	service_running && was_running=1
	echo "升级前服务状态: $([ "$was_running" = 1 ] && echo 运行中 || echo 已停止)"
	# Drain even when stopped: refuse an unmanaged core or leftover resources.
	# Replacing a live executable first makes /proc/PID/exe point to '(deleted)'.
	honk_lifecycle_stop 30 || return $?
	echo "--- 安装 $constraint ---"
	apk --cache-dir "$cache" --no-network add "$constraint" || return $?
	installed=$(apk --cache-dir "$cache" list --installed "$PKG") || return $?
	printf '%s\n' "$installed" | awk -v expected="$PKG-$ver" '$1 == expected { found=1 } END { exit !found }' || {
		echo "result: 目标版本 $constraint 未安装"
		return 1
	}

	# Use the installed lifecycle implementation, not the pre-upgrade copy.
	. /usr/share/honk/lifecycle.sh || return $?
	restore_service_state || return $?
	/etc/init.d/rpcd reload || return $?
}

(
	exec >"$LOG" 2>&1
	work_dir=
	trap '[ -z "$work_dir" ] || rm -rf "$work_dir"; rm -f "$0"' EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM
	echo "$(date '+%F %T') begin upgrade: $PKG"
	rc=0
	upgrade_package || rc=$?
	if [ "$rc" != 0 ]; then
		echo "$(date '+%F %T') ✗ 升级失败 (rc=$rc)，请查看上方错误"
	else
		echo "$(date '+%F %T') ✓ 完成"
	fi
	exit "$rc"
) </dev/null >/dev/null 2>&1 &

echo "started in background, see $LOG"
exit 0
