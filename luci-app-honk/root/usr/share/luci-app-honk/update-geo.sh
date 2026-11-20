#!/bin/sh
# update-geo.sh <geoip|geosite>
# Fork-and-detach so the LuCI RPC call returns immediately. The maintenance
# card polls the .dat file's mtime/size to detect completion. A lock file
# in /tmp prevents concurrent runs.

TYPE="$1"

# The core's own source list lives in the honk package (one list, one order:
# one source, its mirrors), so this path and the panel's own update fetch the
# same bytes and do not fight.
. /usr/share/honk/geodata.sh 2>/dev/null || :
command -v honk_geodata_sources >/dev/null 2>&1 || {
	echo "the honk package's geodata source list is missing" >&2
	exit 70
}

# One data source: prefer the core configuration's assets.geodata.<type> (the
# core's own update uses it too), so both paths fetch the same bytes. The core
# then sees an identical file and skips the replacement instead of fighting
# this script over it. The UCI override is only a fallback for a configuration
# without that key, and the built-in default is the last resort.
geodata_url() {
	type="$1"
	key="$type"
	url=""
	for f in /etc/honk/config.dae /etc/honk/system.dae; do
		[ -f "$f" ] || continue
		got=$(sed -n "s/^[[:space:]]*$key:[[:space:]]*'\([^']*\)'.*/\1/p" "$f" 2>/dev/null | head -1)
		[ -n "$got" ] && { url="$got"; break; }
	done
	[ -n "$url" ] || url="$(uci -q get honk.main.${type}_url)"
	printf '%s' "$url"
}

# The core verifies the published .sha256sum; do the same here so a truncated
# or otherwise damaged download never reaches the filesystem. A mirror without
# a usable sum file falls back to the core validation below.
verify_checksum() {
	cand="$1"
	sum_url="$2.sha256sum"
	want=$(curl -fsSL --proto '=http,https' --proto-redir '=http,https' \
		--connect-timeout 15 --max-time 60 "$sum_url" 2>/dev/null | awk '{print $1; exit}')
	[ -n "$want" ] || return 2
	got=$(sha256sum "$cand" 2>/dev/null | awk '{print $1}')
	[ -n "$got" ] || return 1
	[ "$got" = "$want" ] || return 1
	return 0
}

# Only the core can tell whether a file parses and whether it carries every
# category the active rules use, so let it judge the candidate before it is
# installed: the candidate plus the other current asset go into one asset
# directory and the core validates the configuration against it.
validate_with_core() {
	cand="$1"
	type="$2"
	tmpdir=$(mktemp -d /tmp/honk-geo.XXXXXX) || return 1
	chmod 0700 "$tmpdir" || { rm -rf "$tmpdir"; return 1; }
	cp "$cand" "$tmpdir/$type.dat" 2>/dev/null || { rm -rf "$tmpdir"; return 1; }
	other=geoip
	[ "$type" = geoip ] && other=geosite
	[ -f "/etc/honk/$other.dat" ] && cp "/etc/honk/$other.dat" "$tmpdir/" 2>/dev/null
	[ -f "/usr/share/v2ray/$other.dat" ] && cp "/usr/share/v2ray/$other.dat" "$tmpdir/" 2>/dev/null
	DAE_LOCATION_ASSET="$tmpdir" /usr/bin/honk-core config validate --config /etc/honk/config.dae >/dev/null 2>&1
	rc=$?
	rm -rf "$tmpdir"
	return $rc
}

# The destination is the data directory: the package's copies live in the
# read-only partition, and the core replaces the loaded file in place (a
# read-only path fails the replacement, which is what the panel reported).
#
# The sources are the same list the core uses (one source, its mirrors), in the
# same order, so this path and the panel's own update fetch the same bytes and
# do not fight.
case "$TYPE" in
	geoip)
		URL="$(geodata_url geoip)"
		DEST="/etc/honk/geoip.dat"
		;;
	geosite)
		URL="$(geodata_url geosite)"
		DEST="/etc/honk/geosite.dat"
		;;
	*)
		echo "usage: $0 <geoip|geosite>" >&2
		exit 64
		;;
esac
# One source per list, the same one the core uses (control.sh geodata-sources):
# the addresses of that source (raw and jsDelivr, the mirrors of one file), in
# the same order, so both paths fetch the same bytes and do not fight. One
# that does not answer is skipped and the next one is tried. A configured
# address that is not one of the known sources is used on its own: the user's
# own choice wins on both paths.
if [ -n "$URL" ]; then
	# the known sources come with their mirrors; an older honk package does not
	# have the helper, then the address is used on its own
	if command -v honk_geodata_list_for >/dev/null 2>&1; then
		URLS="$(honk_geodata_list_for "$URL" "$TYPE")"
	else
		URLS="$URL"
	fi
else
	URLS="$(honk_geodata_sources "$TYPE")"
fi

LOCK="/tmp/luci-app-honk.${TYPE}.lock"
LOG="/tmp/luci-app-honk.${TYPE}.log"

schedule_backend_reload() {
	if /bin/pidof honk-core >/dev/null 2>&1; then
		(
			sleep 25
			if /usr/bin/honk-core reload >/dev/null 2>&1; then
				echo "$(date '+%F %T') reloaded honk-core"
			else
				echo "$(date '+%F %T') honk-core reload failed"
			fi
		) </dev/null >>"$LOG" 2>&1 &
	fi
}

if [ -f "$LOCK" ]; then
	# Lock is fresh (< 5 min)? Refuse. Stale? Remove and proceed.
	mtime=$(date -r "$LOCK" +%s 2>/dev/null || echo 0)
	age=$(( $(date +%s) - mtime ))
	if [ "$age" -lt 300 ]; then
		echo "${TYPE} update already in progress (PID $(cat "$LOCK" 2>/dev/null), age ${age}s)" >&2
		exit 75
	fi
	rm -f "$LOCK"
fi

if ! ( set -C; echo "$$" >"$LOCK" ) 2>/dev/null; then
	echo "${TYPE} update already in progress" >&2
	exit 75
fi

# Spawn detached worker — parent returns immediately to LuCI.
(
	exec >"$LOG" 2>&1
	trap 'rm -f "$LOCK"' EXIT INT TERM

	rc=0
	TMP="${DEST}.new"
	mkdir -p "$(dirname "$DEST")"
	echo "$(date '+%F %T') begin: $URLS"

	# One that does not answer is skipped and the next one is tried: the list holds
	# the mirrors of one source (raw, then jsDelivr). The core walks the same
	# list in the same order.
	for URL in $URLS; do
		if curl -fsSL --proto '=http,https' --proto-redir '=http,https' --connect-timeout 15 --max-time 240 -o "$TMP" "$URL"; then
			break
		fi
		rm -f "$TMP"
		echo "$(date '+%F %T') $URL failed, trying the next one"
	done
	if [ ! -s "$TMP" ]; then
		echo "$(date '+%F %T') download failed"
		rm -f "$TMP"
		rc=1
	else
		size=$(wc -c < "$TMP" 2>/dev/null || echo 0)
		magic=$(hexdump -n 1 -e '1/1 "%02x"' "$TMP" 2>/dev/null)
		if [ "$size" -lt 1024 ]; then
			echo "$(date '+%F %T') file too small ($size bytes)"
			rm -f "$TMP"
			rc=2
		elif [ "$magic" != "0a" ]; then
			echo "$(date '+%F %T') invalid geodata format"
			rm -f "$TMP"
			rc=3
		else
			verify_checksum "$TMP" "$URL"
			sum_rc=$?
			if [ "$sum_rc" = 1 ]; then
				echo "$(date '+%F %T') checksum mismatch against $URL.sha256sum"
				rm -f "$TMP"
				rc=5
			elif [ "$sum_rc" = 2 ]; then
				echo "$(date '+%F %T') no usable .sha256sum, relying on the core validation only"
			fi
			if [ "$rc" = 0 ] && ! validate_with_core "$TMP" "$TYPE"; then
				echo "$(date '+%F %T') the candidate failed the core validation (unparsable, or missing a category the rules use)"
				rm -f "$TMP"
				rc=4
			elif [ "$rc" = 0 ]; then
				mv "$TMP" "$DEST"
				echo "$(date '+%F %T') updated $DEST ($size bytes)"
				schedule_backend_reload
			fi
		fi
	fi
	if [ "$rc" = 0 ]; then echo "$(date '+%F %T') ✓ 完成"; else echo "$(date '+%F %T') ✗ 失败 (rc=$rc)"; fi
) </dev/null >/dev/null 2>&1 &

echo "started in background, see $LOG"
exit 0
