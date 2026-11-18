#!/usr/bin/env python3
"""Verify a source-asset bundle before publishing.

The reviewed manifest is the trust anchor: every asset name and digest is fixed
here, so a bundle cannot shrink the set by editing its own checksum file.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

CORE_COMMIT = "64848881b7304e250e7a25422f4f1d86a5975eca"
CORE_ARCHES = ("x86_64", "aarch64", "armv7")
EXPECTED_TAG = "source-verified-20261117"
TAG_PATTERN = re.compile(r"^source-[A-Za-z0-9._-]+$")

CORE_ASSETS = {
    "x86_64": "honk-core-%s-x86_64.tar.gz" % CORE_COMMIT,
    "aarch64": "honk-core-%s-aarch64.tar.gz" % CORE_COMMIT,
    "armv7": "honk-core-%s-armv7.tar.gz" % CORE_COMMIT,
}
DOONA_ASSET = "doona-9dcb9489-355f3716f059.tar.gz"
META_ASSETS = ("generated-stage.mk", "generated-doona-stage.mk", "generated-provenance.json")
ALL_ASSETS = tuple(CORE_ASSETS[a] for a in CORE_ARCHES) + (DOONA_ASSET,) + META_ASSETS

ELF_MACHINE = {
    "x86_64": "Advanced Micro Devices X86-64",
    "aarch64": "AArch64",
    "armv7": "ARM",
}
EXPECTED_PROVENANCE = {
    "commit": CORE_COMMIT,
    "configuration_patch_sha256": "8ae263b0e3bbc97274a764a999af5bf1eff32c09219a4ef2dfd5da087d69001b",
    "builder_sha256": "d388d6a05506231216122a882d1b3d51261deec75dcf6146db62bd70a73f8a4a",
}
EXPECTED_DOONA = {
    "commit": "9dcb948976da9f0cc0a77f158edef8998d0df661",
    "patch": "7cc1e936a25c116177c90c279156d70cff757556891cd52dfa6ef5c93cc7fb9e",
    "archive": DOONA_ASSET,
}
RUNTIME_CASES = {"true": "true", "false": "false", "omitted": "true"}
# Reviewed digests (trust anchor). The manifest is checked against these, so
# editing the bundle, its SHA256SUMS and the manifest together still fails.
REVIEWED_DIGESTS = {
    CORE_ASSETS["x86_64"]: "496157e2ec9d8af457fce9be1b00758b4fec7b1fcce8d1e916162982fd599981",
    CORE_ASSETS["aarch64"]: "c32e88cb138c31963b309c5ee150ec094868d91ab13020f1ee0f2bbd054e83d6",
    CORE_ASSETS["armv7"]: "53d75ef91db267a112fb7cacf5c3521b43e69ed10f6acdabb4dbf4ab2125d5ba",
    DOONA_ASSET: "355f3716f059904ea5a74969e46af59cf282253101fb7cb27a778a2c620c32de",
    "generated-stage.mk": "951605b31a1ec77b8d10bdd7474bcfee9e53085687c7004231c05627d4d7171c",
    "generated-doona-stage.mk": "b25c67031f509abb09a71dc0045a94014d759cf3064ce85e81f381b93c87a1c0",
    "generated-provenance.json": "56bc285dddf8e88a7cc7bc875200278e7e9fdaa6f7120f43d49963ecd84b9719",
}



class Result:
    def __init__(self):
        self.failures = []
        self.cases_run = 0

    def fail(self, category, message):
        self.failures.append((category, message))

    def ok(self):
        return not self.failures

    def report(self, tag):
        for category, message in self.failures:
            print("FAIL [%s] %s" % (category, message), file=sys.stderr)
        print("tag: %s" % tag)
        print("runtime cases: %d/3" % self.cases_run)
        return 0 if self.ok() else 1


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(raw, result):
    if isinstance(raw, str) and os.path.isfile(raw):
        try:
            raw = open(raw, "r", encoding="utf-8").read()
        except OSError as exc:
            result.fail("manifest", "cannot read manifest: %s" % exc)
            return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError) as exc:
        result.fail("manifest", "not valid JSON: %s" % exc)
        return {}
    if not isinstance(data, dict):
        result.fail("manifest", "must be a JSON object")
        return {}
    return data


def validate_manifest(manifest, result):
    """The manifest may not decide which assets exist; it must match ALL_ASSETS."""
    if set(manifest) != set(ALL_ASSETS):
        missing = sorted(set(ALL_ASSETS) - set(manifest))
        extra = sorted(set(manifest) - set(ALL_ASSETS))
        if missing:
            result.fail("manifest", "does not list required assets: %s" % ", ".join(missing))
        if extra:
            result.fail("manifest", "lists unexpected assets: %s" % ", ".join(extra))
        return False
    ok = True
    for name, digest in manifest.items():
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            result.fail("manifest", "%s: digest is not 64 lowercase hex" % name)
            ok = False
            continue
        if digest != REVIEWED_DIGESTS[name]:
            result.fail("manifest", "%s: digest %s does not match the reviewed value" % (name, digest))
            ok = False
    return ok


def parse_sha256sums(bundle, result):
    path = os.path.join(bundle, "SHA256SUMS")
    if not os.path.isfile(path):
        result.fail("checksums", "SHA256SUMS missing")
        return {}
    entries = {}
    for lineno, line in enumerate(open(path, "r", encoding="utf-8"), 1):
        line = line.rstrip("\n")
        if not line.strip():
            continue
        match = re.fullmatch(r"([a-f0-9]{64})  (.+)", line)
        if not match:
            result.fail("checksums", "line %d is malformed" % lineno)
            continue
        digest, name = match.groups()
        if name in entries:
            result.fail("checksums", "repeats %s" % name)
            continue
        entries[name] = digest
    if "SHA256SUMS" in entries:
        result.fail("checksums", "must not cover itself")
    if set(entries) != set(ALL_ASSETS):
        missing = sorted(set(ALL_ASSETS) - set(entries))
        extra = sorted(set(entries) - set(ALL_ASSETS))
        if missing:
            result.fail("checksums", "missing entries: %s" % ", ".join(missing))
        if extra:
            result.fail("checksums", "unexpected entries: %s" % ", ".join(extra))
    return entries


def check_bundle_files(bundle, result):
    on_disk = set()
    for entry in os.listdir(bundle):
        full = os.path.join(bundle, entry)
        if os.path.islink(full):
            result.fail("bundle", "symlink not allowed: %s" % entry)
            continue
        if os.path.isdir(full):
            result.fail("bundle", "unexpected directory: %s" % entry)
            continue
        if entry != "SHA256SUMS":
            on_disk.add(entry)
    missing = sorted(set(ALL_ASSETS) - on_disk)
    extra = sorted(on_disk - set(ALL_ASSETS))
    if missing:
        result.fail("bundle", "missing assets: %s" % ", ".join(missing))
    if extra:
        result.fail("bundle", "unexpected files: %s" % ", ".join(extra))
    return not missing


def verify_hashes(bundle, manifest, entries, result):
    if not manifest or not entries:
        return False
    ok = True
    for name in ALL_ASSETS:
        expected = manifest.get(name)
        listed = entries.get(name)
        if expected is None or listed is None:
            ok = False
            continue
        if expected != listed:
            result.fail("checksums", "%s: SHA256SUMS differs from reviewed manifest" % name)
            ok = False
        path = os.path.join(bundle, name)
        if not os.path.isfile(path):
            ok = False
            continue
        actual = sha256_file(path)
        if actual != expected:
            result.fail("hash", "%s: %s != expected %s" % (name, actual, expected))
            ok = False
    return ok


def verify_stage(bundle, tag, manifest, result):
    path = os.path.join(bundle, "generated-stage.mk")
    if not os.path.isfile(path):
        return
    text = open(path, "r", encoding="utf-8").read()
    url = re.search(r"^PKG_SOURCE_URL:=(.+)$", text, re.M)
    expected_url = "https://github.com/kenzok8/openwrt-honk/releases/download/%s/" % tag
    if not url:
        result.fail("stage", "PKG_SOURCE_URL missing")
    elif url.group(1).strip() != expected_url:
        result.fail("stage", "PKG_SOURCE_URL is %r, expected %r" % (url.group(1).strip(), expected_url))
    for arch in CORE_ARCHES:
        upper = arch.upper()
        asset = re.search(r"^HONK_ASSET_%s:=(.+)$" % upper, text, re.M)
        digest = re.search(r"^HONK_HASH_%s:=(.+)$" % upper, text, re.M)
        if not asset or asset.group(1).strip() != CORE_ASSETS[arch]:
            result.fail("stage", "HONK_ASSET_%s must be %s" % (upper, CORE_ASSETS[arch]))
        if not digest or digest.group(1).strip() != manifest.get(CORE_ASSETS[arch]):
            result.fail("stage", "HONK_HASH_%s must equal the reviewed digest of %s" % (upper, CORE_ASSETS[arch]))


def verify_doona_stage(bundle, tag, manifest, result):
    path = os.path.join(bundle, "generated-doona-stage.mk")
    if not os.path.isfile(path):
        result.fail("stage", "generated-doona-stage.mk missing")
        return
    text = open(path, "r", encoding="utf-8").read()
    fields = {}
    for key in ("PKG_SOURCE", "PKG_SOURCE_URL", "PKG_HASH", "PKG_SOURCE_SUBDIR"):
        match = re.search(r"^%s:=(.+)$" % key, text, re.M)
        if match:
            fields[key] = match.group(1).strip()
        else:
            result.fail("stage", "generated-doona-stage.mk missing %s" % key)
    expected_url = "https://github.com/kenzok8/openwrt-honk/releases/download/%s" % tag
    if fields.get("PKG_SOURCE") != DOONA_ASSET:
        result.fail("stage", "PKG_SOURCE must be %s" % DOONA_ASSET)
    if fields.get("PKG_HASH") != manifest.get(DOONA_ASSET):
        result.fail("stage", "PKG_HASH must equal the reviewed digest of %s" % DOONA_ASSET)
    if fields.get("PKG_SOURCE_URL") != expected_url:
        result.fail("stage", "PKG_SOURCE_URL is %r, expected %r" % (fields.get("PKG_SOURCE_URL"), expected_url))
    if fields.get("PKG_SOURCE_SUBDIR") != "doona":
        result.fail("stage", "PKG_SOURCE_SUBDIR must be doona")


def verify_provenance(bundle, result):
    path = os.path.join(bundle, "generated-provenance.json")
    if not os.path.isfile(path):
        return
    try:
        data = json.load(open(path, "r", encoding="utf-8"))
    except ValueError as exc:
        result.fail("provenance", "not valid JSON: %s" % exc)
        return
    core = data.get("core") or {}
    for key, expected in EXPECTED_PROVENANCE.items():
        if core.get(key) != expected:
            result.fail("provenance", "%s is %r, expected %r" % (key, core.get(key), expected))
    if core.get("lane") != "stable":
        result.fail("provenance", "lane is %r, expected 'stable'" % core.get("lane"))
    arches = core.get("architectures")
    if not isinstance(arches, list) or len(arches) != 3 or set(arches) != set(CORE_ARCHES):
        result.fail("provenance", "architectures must list exactly %r" % (list(CORE_ARCHES),))


def run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def unpack_core(bundle, arch, result):
    path = os.path.join(bundle, CORE_ASSETS[arch])
    workdir = tempfile.mkdtemp(prefix="honk-%s-" % arch)
    proc = run(["tar", "xzf", path, "-C", workdir])
    if proc.returncode != 0:
        result.fail("unpack", "%s: %s" % (CORE_ASSETS[arch], proc.stderr.strip()))
        shutil.rmtree(workdir, ignore_errors=True)
        return None, None
    for root, _dirs, files in os.walk(workdir):
        if "honk-core" in files:
            return os.path.join(root, "honk-core"), workdir
    result.fail("unpack", "%s has no honk-core" % CORE_ASSETS[arch])
    shutil.rmtree(workdir, ignore_errors=True)
    return None, None


def verify_elf(binary, arch, result):
    proc = run(["readelf", "-h", binary])
    match = re.search(r"Machine:\s+(.+)", proc.stdout)
    if proc.returncode != 0 or not match:
        result.fail("elf", "%s: readelf gave no Machine" % arch)
    elif ELF_MACHINE[arch] not in match.group(1):
        result.fail("elf", "%s: Machine %r" % (arch, match.group(1).strip()))
    if "statically linked" not in run(["file", binary]).stdout:
        result.fail("elf", "%s: not statically linked" % arch)


def runtime_cases(binary, result):
    workdir = tempfile.mkdtemp(prefix="honk-cases-")
    try:
        for label, expected in RUNTIME_CASES.items():
            field = "" if label == "omitted" else "    nfqueue_enable: %s\n" % label
            config = os.path.join(workdir, "%s.dae" % label)
            with open(config, "w", encoding="utf-8") as fh:
                fh.write(
                    "global {\n    wan_interface: auto\n    lan_interface: \"br-lan\"\n"
                    "    data_dir: \"%s\"\n    store_subscribe: false\n%s}\n"
                    "experimental {\n    native_api {\n        enabled: true\n"
                    "        listen: \"127.0.0.1:39201\"\n        password_auth: false\n"
                    "        allow_anonymous_loopback: true\n        config_write: false\n"
                    "    }\n}\nrouting {\n    fallback: direct\n}\n" % (workdir, field)
                )
            proc = run([binary, "config", "validate", "--config", config])
            if proc.returncode != 0:
                result.fail("runtime", "%s: validate exited %d" % (label, proc.returncode))
                continue
            try:
                payload = json.loads(proc.stdout)
            except ValueError:
                result.fail("runtime", "%s: response is not JSON" % label)
                continue
            if payload.get("ok") is not True:
                result.fail("runtime", "%s: ok is not true" % label)
            value = (payload.get("runtime") or {}).get("nfqueue_enable")
            if not isinstance(value, bool):
                result.fail("runtime", "%s: nfqueue_enable is not a boolean" % label)
            elif ("true" if value else "false") != expected:
                result.fail("runtime", "%s: nfqueue_enable=%s" % (label, value))
            else:
                result.cases_run += 1
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def verify_doona_source(bundle, result):
    path = os.path.join(bundle, DOONA_ASSET)
    workdir = tempfile.mkdtemp(prefix="honk-doona-")
    try:
        if run(["tar", "xzf", path, "-C", workdir]).returncode != 0:
            result.fail("doona", "archive failed to unpack")
            return
        source = next((os.path.join(r, "SOURCE") for r, _d, f in os.walk(workdir) if "SOURCE" in f), None)
        if not source:
            result.fail("doona", "archive has no SOURCE")
            return
        text = open(source, "r", encoding="utf-8").read()
        commit = re.search(r"^Commit:\s*(\S+)", text, re.M)
        patch = re.search(r"^Build patch SHA256:\s*(\S+)", text, re.M)
        if not commit or commit.group(1) != EXPECTED_DOONA["commit"]:
            result.fail("doona", "SOURCE commit is %r" % (commit.group(1) if commit else None))
        if not patch or patch.group(1) != EXPECTED_DOONA["patch"]:
            result.fail("doona", "SOURCE patch is %r" % (patch.group(1) if patch else None))
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--tag", default=EXPECTED_TAG)
    args = parser.parse_args()

    result = Result()
    bundle = os.path.abspath(args.bundle)
    tag = args.tag.strip()

    if not TAG_PATTERN.fullmatch(tag):
        result.fail("tag", "tag %r does not match the expected format" % tag)
        return result.report(tag)
    if not os.path.isdir(bundle):
        result.fail("bundle", "not a directory: %s" % bundle)
        return result.report(tag)

    manifest = load_manifest(args.manifest, result)
    manifest_ok = validate_manifest(manifest, result) if manifest else False
    files_ok = check_bundle_files(bundle, result)
    entries = parse_sha256sums(bundle, result)
    hash_ok = verify_hashes(bundle, manifest, entries, result) if (manifest_ok and files_ok) else False

    verify_stage(bundle, tag, manifest, result)
    verify_doona_stage(bundle, tag, manifest, result)
    verify_provenance(bundle, result)

    # Unpack only after every asset matched the reviewed digests.
    if hash_ok:
        for arch in CORE_ARCHES:
            binary, workdir = unpack_core(bundle, arch, result)
            if not binary:
                continue
            try:
                verify_elf(binary, arch, result)
                if arch == "x86_64":
                    runtime_cases(binary, result)
            finally:
                shutil.rmtree(workdir, ignore_errors=True)
        verify_doona_source(bundle, result)
    else:
        result.fail("gate", "skipped unpacking: bundle digests did not match the reviewed manifest")

    if result.cases_run != 3 and hash_ok:
        result.fail("runtime", "expected 3/3 runtime cases, got %d" % result.cases_run)

    return result.report(tag)


if __name__ == "__main__":
    sys.exit(main())
