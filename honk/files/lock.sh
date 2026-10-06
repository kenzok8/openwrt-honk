#!/bin/sh

HONK_LOCK_DIR=/run/honk.lock

honk_lock_acquire() {
	mkdir "$HONK_LOCK_DIR" 2>/dev/null || return 1
	chmod 0700 "$HONK_LOCK_DIR" || { rmdir "$HONK_LOCK_DIR"; return 1; }
	printf '%s\n' "$$" > "$HONK_LOCK_DIR/pid" || { rm -f "$HONK_LOCK_DIR/pid"; rmdir "$HONK_LOCK_DIR"; return 1; }
}

honk_lock_is_stale() {
	owner=$(cat "$HONK_LOCK_DIR/pid" 2>/dev/null)
	case "$owner" in ''|*[!0-9]*) return 1 ;; esac
	! kill -0 "$owner" 2>/dev/null
}

honk_lock_release() {
	[ "$(cat "$HONK_LOCK_DIR/pid" 2>/dev/null)" = "$$" ] || return 1
	rm -f "$HONK_LOCK_DIR/pid" && rmdir "$HONK_LOCK_DIR"
}
