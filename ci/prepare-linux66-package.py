#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Stage experimental packages without changing stable package metadata."""

import hashlib
import json
import os
import re
import shutil
from pathlib import Path


def luci_makefile_archive(root: Path) -> str:
    text = (root / "luci-app-honk/Makefile").read_text()
    match = re.search(r"^PKG_SOURCE:=(.+)$", text, re.M)
    if not match:
        raise ValueError("luci-app-honk PKG_SOURCE missing")
    return match.group(1).strip()


def prepare(root):
    stage = root / "honk/generated-linux66-stage.mk"
    provenance = root / "honk/generated-linux66-provenance.json"
    data = json.loads(provenance.read_text())
    core = data["core"]
    if core.get("lane") != "linux66":
        raise ValueError("not a Linux 6.6 compatibility build")
    architectures = core["architectures"]
    symbols = {"x86_64": "x86_64", "aarch64": "aarch64", "armv7": "arm"}
    if not architectures or any(arch not in symbols for arch in architectures):
        raise ValueError("unsupported compatibility architecture")
    assignments = dict(re.findall(r"^([A-Z0-9_]+):=(.*)$", stage.read_text(), re.M))
    for arch in architectures:
        suffix = arch.upper()
        archive = assignments[f"HONK_ASSET_{suffix}"]
        if Path(archive).name != archive:
            raise ValueError("archive must be a basename")
        digest = hashlib.sha256((root / "artifacts/cache" / archive).read_bytes()).hexdigest()
        if digest != assignments[f"HONK_HASH_{suffix}"]:
            raise ValueError(f"archive digest mismatch: {archive}")

    output = root / "artifacts/linux66-package"
    output.mkdir(parents=True, exist_ok=False)
    downloads = output / "dl"
    downloads.mkdir()
    for arch in architectures:
        archive = assignments[f"HONK_ASSET_{arch.upper()}"]
        shutil.copyfile(root / "artifacts/cache" / archive, downloads / archive)
    for name in ("honk", "luci-app-honk"):
        shutil.copytree(root / name, output / name, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("tests", "generated-*.mk", "generated-*.json"))
    makefile = output / "honk/Makefile"
    text = makefile.read_text()
    old = "@(x86_64||aarch64||arm)"
    if old not in text:
        raise ValueError("package architecture constraint changed")
    text = text.replace(old, "@(" + "||".join(symbols[arch] for arch in architectures) + ")", 1)
    version = os.environ.get("LINUX66_VERSION", "").strip()
    if version:
        if not re.fullmatch(r"\d{4}\.\d{2}\.\d{2}(\.\d+)?", version):
            raise ValueError("unexpected LINUX66_VERSION")
        text = re.sub(r"^PKG_VERSION:=.*$", f"PKG_VERSION:={version}", text, count=1, flags=re.M)
        text = re.sub(r"^PKG_RELEASE:=.*$", "PKG_RELEASE:=1", text, count=1, flags=re.M)
    makefile.write_text(text)

    doona = luci_makefile_archive(root)
    shutil.copyfile(root / "artifacts/cache" / doona, downloads / doona)
    luci_makefile = output / "luci-app-honk/Makefile"
    luci_text = luci_makefile.read_text()
    luci_new, count = re.subn(
        r"^PKG_SOURCE_URL\?=.*$", "PKG_SOURCE_URL:=file:///feed/dl/", luci_text, count=1, flags=re.M
    )
    if count != 1:
        raise ValueError("luci-app-honk source url changed")
    luci_makefile.write_text(luci_new)
    (output / "honk/generated-stage.mk").write_text(
        stage.read_text() + "HONK_CORE_LANE:=linux66\n" + f"CORE_COMMIT:={core['commit']}\n"
        + "PKG_SOURCE_URL:=file:///feed/dl/\n")
    shutil.copyfile(provenance, output / "honk/generated-provenance.json")
    print(output)
    print("Local experimental build only; package versions are not release assignments.")


if __name__ == "__main__":
    prepare(Path(__file__).resolve().parent.parent)
