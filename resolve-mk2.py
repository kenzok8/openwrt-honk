import io

p = r"C:\路由设计\work\honk-merge\honk\Makefile"
s = io.open(p, encoding="utf-8").read()

old_comment = """# Pinned honk-core revision (Glassyiris/honk feat/native-api), cross-compiled by
# ci/build-core.sh. Every release run publishes its core archives under an
# immutable source-<run_id> tag; the tag and SHA-256 values below are the exact
# assets behind CORE_COMMIT, so a plain feed build downloads and verifies them
# without any generated file. A staged run may still override them through
# honk/generated-stage.mk, which is generated and never committed.
"""
new_comment = """# Pinned honk-core revision (Glassyiris/honk feat/native-api), cross-compiled by
# ci/build-core.sh. That script also applies ci/patches/honk-direct-unspec.py:
# direct-classified flows are handed back to the classic TC chain, so a packet
# accelerator (dpd on x86/rockchip, the kernel flowtable on IPQ) keeps seeing
# them while honk proxies the rest. The -p1 suffix in the asset name is the
# patch revision and keeps these archives apart from upstream's unpatched ones;
# they are published under the fixed `core-p1` tag. A staged run still overrides
# URL/assets/hashes through honk/generated-stage.mk, which is never committed.
"""
assert old_comment in s
s = s.replace(old_comment, new_comment, 1)

old_pin = """HONK_SOURCE_TAG?=source-41012758310
HONK_SOURCE_URL?=https://github.com/kenzok8/openwrt-honk/releases/download/$(HONK_SOURCE_TAG)
"""
new_pin = """HONK_SOURCE_TAG?=core-p1
HONK_SOURCE_URL?=https://github.com/kwrum1/openwrt-honk/releases/download/$(HONK_SOURCE_TAG)
"""
assert old_pin in s
s = s.replace(old_pin, new_pin, 1)

s = s.replace(
    "PKG_SOURCE_URL?=https://github.com/kwrum1/openwrt-honk/releases/download/core-p1/",
    "PKG_SOURCE_URL?=$(HONK_SOURCE_URL)/",
    1,
)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("honk/Makefile: pin points at core-p1, comment updated")
