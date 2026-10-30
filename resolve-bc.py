import io
import re

p = r"C:\路由设计\work\honk-merge\ci\build-core.sh"
s = io.open(p, encoding="utf-8").read()

pat = re.compile(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> upstream/main\n", re.S)
m = pat.search(s)
assert m, "no conflict"

merged = """CORE_PATCH="$ROOT/ci/patches/honk-core-config-validate.patch"
git -C "$WORK_DIR/source" apply --check "$CORE_PATCH"
git -C "$WORK_DIR/source" apply "$CORE_PATCH"
git -C "$WORK_DIR/source" diff --check

# p1: hand direct-classified flows back to the classic TC chain so a packet
# accelerator (dpd on x86/rockchip, the kernel flowtable on IPQ) keeps seeing
# them while honk proxies the rest. Kept as a script, like the vendor patches
# above, so a context drift in the pinned commit fails loudly instead of
# silently shipping an unpatched core.
python3 "$ROOT/ci/patches/honk-direct-unspec.py" "$WORK_DIR/source"
"""

s = s[: m.start()] + merged + s[m.end() :]
assert "<<<<<<<" not in s
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("build-core.sh resolved")

# sanity: our LF normalisation and p1 artifact naming must still be somewhere
for needle in ("direct-unspec.py", "honk-core-config-validate.patch"):
    print("  has", needle, ":", needle in s)
