import io
import re

p = r"C:\路由设计\work\honk-merge\honk\Makefile"
s = io.open(p, encoding="utf-8").read()


def resolve(s, index, ours, theirs):
    """Replace the index-th conflict block with `theirs` (upstream) or `ours`."""
    pat = re.compile(
        r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> upstream/main\n", re.S
    )
    matches = list(pat.finditer(s))
    m = matches[index]
    body = ours if ours is not None else theirs
    return s[: m.start()] + body + s[m.end() :]


# 1) PKG_RELEASE + comment: keep upstream wording, bump release to 3 (our package
#    differs: p1 assets, nfqueue deps off, direct-unspec marker).
s = resolve(s, 0, None, None) if False else s
m = list(re.compile(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> upstream/main\n", re.S).finditer(s))
b0 = m[0]
ours0, theirs0 = b0.group(1), b0.group(2)
theirs0 = theirs0.replace("PKG_RELEASE:=2", "PKG_RELEASE:=3")
s = s[: b0.start()] + theirs0 + s[b0.end() :]

# remaining conflicts re-evaluate (indices shift)
m = list(re.compile(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> upstream/main\n", re.S).finditer(s))

# 2) asset names/hashes: ours (p1 suffix, SKIP hashes; generated-stage.mk supplies real ones)
b = m[0]
s = s[: b.start()] + b.group(1) + s[b.end() :]

m = list(re.compile(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> upstream/main\n", re.S).finditer(s))

# 3) PKG_SOURCE_URL: ours (core-p1 fixed tag holds the p1 assets)
b = m[0]
s = s[: b.start()] + b.group(1) + s[b.end() :]

m = list(re.compile(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> upstream/main\n", re.S).finditer(s))

# 4) provenance: upstream's "only if generated" guard + our direct-unspec marker
b = m[0]
s = s[: b.start()] + b.group(2).rstrip("\n") + "\n\t$(INSTALL_DATA) $(CURDIR)/files/direct-unspec $(1)/usr/share/honk/direct-unspec\n" + s[b.end() :]

assert "<<<<<<<" not in s and ">>>>>>>" not in s
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("honk/Makefile resolved")
print(s[s.index("PKG_VERSION"): s.index("PKG_BUILD_DIR")])
