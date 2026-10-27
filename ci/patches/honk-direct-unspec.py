#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Hand direct-classified flows back to the classic TC chain.

Why this exists
---------------
honk's LAN TCX program is terminal for everything it classifies, including
`direct(must)` and offloaded direct: those exits return TC_ACT_OK.  The kernel
only continues into the classic chain on TC_ACT_UNSPEC (net/core/dev.c:
`if (tcx_needed) { ret = tcx_run(); if (ret != TC_ACT_UNSPEC) goto verdict; }`).
A classic packet accelerator (mydist's dpd) therefore never sees direct flows
while the proxy runs, and the only honest mode for it is observe.

This patch changes ONLY the direct exits:

  * tag those packets with DIRECT_UNSPEC_MARK (a dedicated skb-mark bit) and
    return TC_ACT_UNSPEC instead of TC_ACT_OK;
  * on the bridge master/slave second pass, a packet carrying that bit skips
    honk's classification again but still returns TC_ACT_UNSPEC, so the
    classic chain runs there too.

Proxy and block verdicts are untouched: proxy still redirects into dae0, block
still drops, and neither ever reaches the classic chain.  NAT is still einat's
job on the WAN (honk does no masquerade).

The patch is applied to the pinned upstream checkout by ci/build-core.sh; the
mydist OpenWrt side installs /usr/share/honk/direct-unspec so dpd's gate knows
the running core has this behaviour.
"""

import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
common = root / "crates/honk-ebpf-common/src/lib.rs"
ingress = root / "crates/honk-ebpf/src/ingress.rs"

# --- 1. a dedicated mark bit -------------------------------------------------
s = common.read_text(encoding="utf-8")
anchor = "pub const CLASSIFIED_MARK: u32 = 0x4000_0000;\n"
assert anchor in s, "CLASSIFIED_MARK anchor not found in honk-ebpf-common"
addition = anchor + """/// Direct verdict already taken; continue into the classic TC chain.
///
/// honk stays the owner of proxy/block verdicts.  Only direct flows are handed
/// back, because a classic-chain accelerator behind the TCX hook can take them
/// over without ever seeing a proxied packet.  A dedicated bit is required:
/// CLASSIFIED_MARK is terminal for every other classified packet.
pub const DIRECT_UNSPEC_MARK: u32 = 0x2000_0000;
"""
s = s.replace(anchor, addition, 1)
common.write_text(s, encoding="utf-8")

# --- 2. ingress: import, second-pass check, four direct exits ---------------
s = ingress.read_text(encoding="utf-8")

old = "    CLASSIFIED_MARK, DATAPATH_FLAG_NFQ_ENABLED"
new = "    CLASSIFIED_MARK, DIRECT_UNSPEC_MARK, DATAPATH_FLAG_NFQ_ENABLED"
assert old in s, "ingress import line not found"
s = s.replace(old, new, 1)

old = """    // Bridge master/slave double attachment must not reclassify either an
    // already-final packet or a held packet carrying its unique queue token.
    if unsafe { (*ctx.skb.skb).mark } & (CLASSIFIED_MARK | NFQUEUE_PENDING_MARK) != 0 {
        return Err(TC_ACT_OK);
    }
"""
new = """    // Bridge master/slave double attachment must not reclassify either an
    // already-final packet or a held packet carrying its unique queue token.
    // Direct-classified packets carry DIRECT_UNSPEC_MARK: skip classification
    // here as well, but continue into the classic chain instead of ending it.
    let honk_ingress_mark = unsafe { (*ctx.skb.skb).mark };
    if honk_ingress_mark & DIRECT_UNSPEC_MARK != 0 {
        return Err(TC_ACT_UNSPEC);
    }
    if honk_ingress_mark & (CLASSIFIED_MARK | NFQUEUE_PENDING_MARK) != 0 {
        return Err(TC_ACT_OK);
    }
"""
assert old in s, "classified second-pass check not found"
s = s.replace(old, new, 1)

pattern = re.compile(
    r"ctx\.skb\.set_mark\(mark \| CLASSIFIED_MARK\);\n(\s*)return Err\(TC_ACT_OK\);"
)
s, count = pattern.subn(
    lambda m: "ctx.skb.set_mark(mark | CLASSIFIED_MARK | DIRECT_UNSPEC_MARK);\n"
              + m.group(1) + "return Err(TC_ACT_UNSPEC);",
    s,
)
assert count == 4, "expected 4 direct exits, patched %d" % count

ingress.write_text(s, encoding="utf-8")
print("honk-direct-unspec: patched 4 direct exits + second-pass check")
