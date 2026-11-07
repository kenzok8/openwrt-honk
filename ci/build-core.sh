#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Cross-compile the pinned honk-core for every OpenWrt architecture we publish.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/ci/pins.env"
CORE_LANE=${CORE_LANE:-stable}
case "$CORE_LANE" in
	stable) CORE_ARCHS=${CORE_ARCHS:-"x86_64 aarch64 armv7"} ;;
	linux66)
		source "$ROOT/ci/pins-linux66.env"
		CORE_ARCHS=${CORE_ARCHS:-x86_64}
		;;
	*) echo "Unknown core lane: $CORE_LANE" >&2; exit 1 ;;
esac
CORE_MIN_KERNEL=${CORE_MIN_KERNEL:-6.12.0}
if test "$(uname -s)" != Linux || test "$(uname -m)" != x86_64; then
	echo 'The pinned Honk core build requires Linux x86_64.' >&2
	exit 1
fi
CACHE_DIR=${HONK_CACHE_DIR:-"$ROOT/artifacts/cache"}
WORK_DIR=${HONK_WORK_DIR:-"$ROOT/.cache/core-work-$CORE_LANE"}
CARGO_HOME=${CARGO_HOME:-"$ROOT/.cache/cargo"}
export CARGO_HOME
mkdir -p "$CACHE_DIR" "$WORK_DIR" "$CARGO_HOME/bin"

for tool in git rustup cargo zig sha256sum tar readelf curl zstd rg file python3; do
	command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
test "$(zig version)" = "$ZIG_VERSION" || { echo "Expected Zig $ZIG_VERSION." >&2; exit 1; }

# OpenWrt ARCH -> Rust target. arm_cortex-a7 / arm_cortex-a9 share armv7; the
# OpenWrt ARCH name is what honk/Makefile keys on, so keep it as the map key.
# NOTE: i686 is intentionally omitted: aya-obj 0.3.0/0.4.0 ship pre-generated
# Linux bindings for x86_64/aarch64/arm(v7)/mips*/riscv64/s390x/loongarch64
# but not for 32-bit x86, so the generated module is empty (E0432).
declare -A TARGETS=(
	[x86_64]="x86_64-unknown-linux-musl"
	[aarch64]="aarch64-unknown-linux-musl"
	[armv7]="armv7-unknown-linux-musleabihf"
)
# zig spells 32-bit targets differently: armv7 -> arm.
declare -A ZIG_TARGETS=(
	[x86_64]="x86_64-linux-musl"
	[aarch64]="aarch64-linux-musl"
	[armv7]="arm-linux-musleabihf"
)

rm -rf "$WORK_DIR/source"
git clone --quiet "$CORE_REPOSITORY" "$WORK_DIR/source"
git -C "$WORK_DIR/source" checkout --quiet "$CORE_COMMIT"
test "$(git -C "$WORK_DIR/source" rev-parse HEAD)" = "$CORE_COMMIT"
test -f "$WORK_DIR/source/Cargo.lock"

if [ "$CORE_LANE" = linux66 ]; then
	compat_patch="$ROOT/$CORE_COMPAT_PATCH"
	test "$(sha256sum "$compat_patch" | cut -d' ' -f1)" = "$CORE_COMPAT_PATCH_SHA256"
	git -C "$WORK_DIR/source" apply --check "$compat_patch"
	git -C "$WORK_DIR/source" apply "$compat_patch"
fi

CORE_PATCH="$ROOT/ci/patches/honk-core-config-validate.patch"
git -C "$WORK_DIR/source" apply --check "$CORE_PATCH"
git -C "$WORK_DIR/source" apply "$CORE_PATCH"
git -C "$WORK_DIR/source" diff --check

TOOLCHAIN=$(sed -n 's/^channel = "\([^"]*\)"/\1/p' "$WORK_DIR/source/rust-toolchain.toml")
test -n "$TOOLCHAIN"
if ! rustup run "$TOOLCHAIN" rustc --version >/dev/null 2>&1; then
	rustup toolchain install "$TOOLCHAIN" --profile minimal --component rust-src
fi
# eBPF nightly 以上游源码为准（追 main 时它常变），pins 里的值只做兜底。
EBPF_NIGHTLY=$(sed -n 's/^channel = "\([^"]*\)"/\1/p' "$WORK_DIR/source/crates/honk-ebpf/rust-toolchain.toml")
EBPF_NIGHTLY=${EBPF_NIGHTLY:-$NIGHTLY}
if ! rustup run "$EBPF_NIGHTLY" rustc --version >/dev/null 2>&1; then
	rustup toolchain install "$EBPF_NIGHTLY" --profile minimal --component rust-src --component llvm-tools
fi
if ! rustup component list --installed --toolchain "$EBPF_NIGHTLY" | grep -q '^rust-src'; then
	rustup component add --toolchain "$EBPF_NIGHTLY" rust-src
fi
if ! rustup component list --installed --toolchain "$EBPF_NIGHTLY" | grep -q '^llvm-tools'; then
	rustup component add --toolchain "$EBPF_NIGHTLY" llvm-tools
fi
for arch in $CORE_ARCHS; do
	t="${TARGETS[$arch]}"
	if ! rustup target list --installed --toolchain "$TOOLCHAIN" | grep -qx "$t"; then
		rustup target add --toolchain "$TOOLCHAIN" "$t"
	fi
done
rg -q '^clash-api\s*=' "$WORK_DIR/source/crates/honk-core/Cargo.toml"
rg -q '^ebpf\s*=' "$WORK_DIR/source/crates/honk-core/Cargo.toml"
rg -q '^native-api\s*=' "$WORK_DIR/source/crates/honk-core/Cargo.toml"
test -x "$WORK_DIR/source/ci/zigcc"
test -x "$WORK_DIR/source/ci/zigcxx"
test -x "$WORK_DIR/source/ci/zig-bindgen-env"

BPF_LINKER_TGZ="$WORK_DIR/bpf-linker.tar.zst"
BPF_LINKER_URL="https://github.com/aya-rs/bpf-linker/releases/download/v$BPF_LINKER_VERSION/bpf-linker-x86_64-unknown-linux-musl.tar.zst"
curl -fL --retry 5 --retry-delay 10 --retry-all-errors "$BPF_LINKER_URL" -o "$BPF_LINKER_TGZ"
test "$(sha256sum "$BPF_LINKER_TGZ" | cut -d' ' -f1)" = "$BPF_LINKER_SHA256"
zstd -dc "$BPF_LINKER_TGZ" | tar -xf - -C "$CARGO_HOME/bin"
chmod +x "$CARGO_HOME/bin/bpf-linker"
export PATH="$CARGO_HOME/bin:$PATH"
BPF_LINKER_REPORTED_VERSION=$("$CARGO_HOME/bin/bpf-linker" --version)
case "$BPF_LINKER_REPORTED_VERSION" in
	"bpf-linker $BPF_LINKER_VERSION"|"bpf-linker 0.0.0") ;;
	*) echo "Unexpected bpf-linker self-reported version: $BPF_LINKER_REPORTED_VERSION" >&2; exit 1 ;;
esac

# The stable datapath has no architecture-specific kprobe register reads.
if [ "$CORE_LANE" = stable ]; then
	cd "$WORK_DIR/source/crates/honk-ebpf"
	cargo +"$EBPF_NIGHTLY" build --locked --release -Zbuild-std=core --target bpfel-unknown-none
	readelf -S target/bpfel-unknown-none/release/honk-ebpf | rg -q '\.BTF'
fi

# Doona stays on disk (/usr/share/doona) and is served by luci-app-honk, so the
# core only needs the native-api backend, not the embedded UI (native-ui).
FEATURES='clash-api,ebpf,rprx,native-api'

cd "$WORK_DIR/source"
rm -rf "$WORK_DIR/stage"
STAGE_MK="$ROOT/honk/generated-stage.mk"
PROVENANCE="$ROOT/honk/generated-provenance.json"
ASSET_SUFFIX=""
if [ "$CORE_LANE" = linux66 ]; then
	STAGE_MK="$ROOT/honk/generated-linux66-stage.mk"
	PROVENANCE="$ROOT/honk/generated-linux66-provenance.json"
	ASSET_SUFFIX="-linux66"
fi
{
	echo "# Generated by ci/build-core.sh; do not commit."
	echo "PKG_SOURCE_URL:=https://github.com/kenzok8/openwrt-honk/releases/download/${HONK_SOURCE_TAG:-staging}/"
	if [ "$CORE_LANE" = linux66 ]; then
		echo "HONK_CORE_LANE:=linux66"
	fi
} > "$STAGE_MK"

# aya 0.14+ exhaustively destructures libc::timespec. From libc 0.2.19x the
# 32-bit time64 layouts (musl32_time64 / gnu_time_bits64) carry a private
# padding field, so the pattern stops compiling. One-line fix to the vendored
# source; harmless on 64-bit. Matches whatever aya the pinned lock resolves.
if ! cargo +"$TOOLCHAIN" fetch --locked --target x86_64-unknown-linux-musl >/dev/null 2>&1; then
	echo "warning: cargo fetch failed; vendored-source patches below may be skipped" >&2
fi
for aya_utils in "$CARGO_HOME"/registry/src/*/aya-*/src/programs/utils.rs "$WORK_DIR/source/vendor/aya/src/programs/utils.rs"; do
	[ -f "$aya_utils" ] || continue
	sed -i 's/let libc::timespec { tv_sec, tv_nsec } = time;/let libc::timespec { tv_sec, tv_nsec, .. } = time;/' "$aya_utils"
done

# honk-core's monotonic_nanos() builds libc::timespec with a struct literal,
# which breaks on 32-bit musl with musl32_time64 (private __pad0 field), and
# mixes i64 tv_sec with i32 tv_nsec in saturating_add. Patch the pinned
# source; both changes are no-ops on 64-bit.
driver_rs="$WORK_DIR/source/crates/honk-core/src/control/udp_endpoint/driver.rs"
python3 - "$driver_rs" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
old_struct = """    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };"""
new_struct = """    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };"""
assert old_struct in s, "driver.rs timespec literal not found"
s = s.replace(old_struct, new_struct)
old_add = ".saturating_add(ts.tv_nsec)"
new_add = ".saturating_add(ts.tv_nsec as i64)"
assert old_add in s, "driver.rs tv_nsec add not found"
s = s.replace(old_add, new_add)
open(p, "w").write(s)
print("patched driver.rs for 32-bit time_t")
PYEOF

for arch in $CORE_ARCHS; do
	if [ "$CORE_LANE" = linux66 ]; then
		case "$arch" in
			x86_64|aarch64) export AYA_BPF_TARGET_ARCH="$arch" ;;
			armv7) export AYA_BPF_TARGET_ARCH=arm ;;
			*) echo "Unsupported compatibility architecture: $arch" >&2; exit 1 ;;
		esac
		(
			cd crates/honk-ebpf
			cargo +"$EBPF_NIGHTLY" build --locked --release -Zbuild-std=core \
				--target bpfel-unknown-none --target-dir "$WORK_DIR/bpf-$arch"
		)
		ebpf_object="crates/honk-ebpf/target/bpfel-unknown-none/release/honk-ebpf"
		mkdir -p "$(dirname "$ebpf_object")"
		cp "$WORK_DIR/bpf-$arch/bpfel-unknown-none/release/honk-ebpf" "$ebpf_object"
		printf '%s' "$EBPF_NIGHTLY" > "$ebpf_object.toolchain"
		readelf -S "$ebpf_object" | rg -q '\.BTF'
	fi
	target="${TARGETS[$arch]}"
	zig_target="${ZIG_TARGETS[$arch]}"
	lupper=$(printf '%s' "$target" | tr 'a-z-' 'A-Z_')

	export ZIGCC_TARGET="$zig_target"
	eval "export CC_${target//-/_}=\$PWD/ci/zigcc"
	eval "export CXX_${target//-/_}=\$PWD/ci/zigcxx"
	eval "export CARGO_TARGET_${lupper}_LINKER=\$PWD/ci/zigcc"
	# 32-bit musl: Rust's libc defaults time_t to i32 (c_long) unless the
	# musl32_time64 cfg is set, but zig's musl headers (musl >= 1.2.0) use
	# 64-bit time_t, so bindgen sees i64. Force the cfg to align libc's
	# time_t with the actual C library, otherwise boring-sys bindings
	# mismatch libc types (E0308 in boring/src/x509/verify.rs).
	extra_rustflags=""
	case "$arch" in
		armv7) extra_rustflags=" --cfg musl32_time64" ;;
	esac
	eval "export CARGO_TARGET_${lupper}_RUSTFLAGS='-C link-self-contained=no${extra_rustflags}'"
	BINDGEN_EXTRA_CLANG_ARGS=$("$PWD/ci/zig-bindgen-env" "$zig_target")
	export BINDGEN_EXTRA_CLANG_ARGS

	cargo +"$TOOLCHAIN" build --locked --release -p honk-core \
		--no-default-features --features "$FEATURES" --target "$target"

	bin="target/$target/release/honk-core"
	test -x "$bin"
	file "$bin" | rg -q 'ELF'

	asset_base="honk-core-$CORE_COMMIT$ASSET_SUFFIX-$arch"
	stage="$WORK_DIR/stage/$asset_base"
	mkdir -p "$stage"
	install -m 0755 "$bin" "$stage/honk-core"
	cp LICENSE README.md "$stage/"
	if [ "$CORE_LANE" = linux66 ]; then
		python3 - "$stage/core-capabilities.json" "$CORE_LANE" "$bin" "$CORE_MIN_KERNEL" <<'PYEOF'
import hashlib
import json
import sys
from pathlib import Path

output, lane, binary, minimum_kernel = sys.argv[1:]
Path(output).write_text(json.dumps({
    "lane": lane,
    "minimum_kernel": minimum_kernel,
    "core_sha256": hashlib.sha256(Path(binary).read_bytes()).hexdigest(),
}, indent=2) + "\n")
PYEOF
	fi

	archive="$asset_base.tar.gz"
	tar --sort=name --mtime='UTC 2026-01-01' --owner=0 --group=0 --numeric-owner \
		-czf "$CACHE_DIR/$archive" -C "$WORK_DIR/stage" "$asset_base"
	sha=$(sha256sum "$CACHE_DIR/$archive" | cut -d' ' -f1)

	# Per-architecture variables for honk/Makefile.
	printf 'HONK_ASSET_%s:=%s\n' "$(printf '%s' "$arch" | tr 'a-z' 'A-Z')" "$archive" >> "$STAGE_MK"
	printf 'HONK_HASH_%s:=%s\n' "$(printf '%s' "$arch" | tr 'a-z' 'A-Z')" "$sha" >> "$STAGE_MK"
done

CORE_VERSION=$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$WORK_DIR/source/Cargo.toml" | head -n 1)
test -n "$CORE_VERSION"
cat > "$PROVENANCE" <<EOF
{
  "core": {
    "repository": "$CORE_REPOSITORY",
    "commit": "$CORE_COMMIT",
    "version": "$CORE_VERSION",
    "lane": "$CORE_LANE",
    "features": "$FEATURES",
    "architectures": ["x86_64", "aarch64", "armv7"]
  },
  "bpf_linker": {
    "release_version": "$BPF_LINKER_VERSION",
    "reported_version": "$BPF_LINKER_REPORTED_VERSION",
    "sha256": "$BPF_LINKER_SHA256"
  }
}
EOF

python3 - "$PROVENANCE" "$CORE_ARCHS" "${CORE_COMPAT_PATCH_SHA256:-}" "$ROOT" <<'PYEOF'
import hashlib
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text())
data["core"]["architectures"] = sys.argv[2].split()
root = Path(sys.argv[4])
data["core"]["configuration_patch_sha256"] = hashlib.sha256(
    (root / "ci/patches/honk-core-config-validate.patch").read_bytes()).hexdigest()
data["core"]["builder_sha256"] = hashlib.sha256(
    (root / "ci/build-core.sh").read_bytes()).hexdigest()
if sys.argv[3]:
    data["core"]["compatibility_patch_sha256"] = sys.argv[3]
path.write_text(json.dumps(data, indent=2) + "\n")
PYEOF

printf 'Core archives written to %s\n' "$CACHE_DIR"
ls -1 "$CACHE_DIR"/honk-core-"$CORE_COMMIT"-*.tar.gz
