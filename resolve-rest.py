import io
import re

PAT = re.compile(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> upstream/main\n", re.S)


def blocks(s):
    return list(PAT.finditer(s))


def apply(s, fn):
    """fn(index, ours, theirs) -> replacement string; applied back-to-front."""
    ms = blocks(s)
    for idx in range(len(ms) - 1, -1, -1):
        m = ms[idx]
        ours, theirs = m.group(1), m.group(2)
        s = s[: m.start()] + fn(idx, ours, theirs) + s[m.end() :]
    return s


# ---------------------------------------------------------------- control.sh --
p = r"C:\路由设计\work\honk-merge\honk\files\control.sh"
s = io.open(p, encoding="utf-8").read()

FOR_OLD = "for module in sch_ingress cls_bpf veth nft_queue nfnetlink_queue; do"
FOR_NEW = (
    'modules="sch_ingress cls_bpf veth"\n'
    "\tnfqueue_required && modules=\"$modules nft_queue nfnetlink_queue\"\n"
    "\tfor module in $modules; do"
)


def ctl(idx, ours, theirs):
    out = theirs.replace(FOR_OLD, FOR_NEW)
    out = out.replace(
        "kmod-sched-core / kmod-sched-bpf / kmod-veth / kmod-nft-queue",
        "kmod-sched-core / kmod-sched-bpf / kmod-veth",
    )
    assert FOR_OLD not in out
    return out


s = apply(s, ctl)
assert "<<<<<<<" not in s
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("control.sh resolved; nfqueue_required uses:", s.count("nfqueue_required && modules="))

# ------------------------------------------------------------- 90-honk-boot --
p = r"C:\路由设计\work\honk-merge\honk\files\90-honk-boot"
s = io.open(p, encoding="utf-8").read()


def boot(idx, ours, theirs):
    marker = "# Keep .lan/.local names working"
    assert marker in ours
    migration = ours[ours.index(marker) :].rstrip("\n")
    return theirs.rstrip("\n") + "\n\n" + migration + "\n"


s = apply(s, boot)
assert "<<<<<<<" not in s
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("90-honk-boot resolved")

# -------------------------------------------------------------------- README --
p = r"C:\路由设计\work\honk-merge\README.md"
s = io.open(p, encoding="utf-8").read()


def readme(idx, ours, theirs):
    return theirs.replace("kenzok8/openwrt-honk", "kwrum1/openwrt-honk")


s = apply(s, readme)
assert "<<<<<<<" not in s
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("README resolved; kenzok8 left:", s.count("kenzok8/openwrt-honk"))
