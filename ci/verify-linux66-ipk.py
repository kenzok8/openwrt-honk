#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Check experimental IPK payloads before keeping SDK artifacts."""

import argparse
import hashlib
import io
import json
import re
import shutil
import tarfile
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_member(archive, name):
    matches = [item for item in archive.getmembers()
               if item.name.removeprefix("./") == name and item.isfile()]
    require(len(matches) == 1, f"missing or duplicate archive member: {name}")
    return archive.extractfile(matches[0]).read()


def read_ipk(path, makefile):
    with tarfile.open(path, "r:gz") as outer:
        control_data = read_member(outer, "control.tar.gz")
        data = read_member(outer, "data.tar.gz")
    with tarfile.open(fileobj=io.BytesIO(control_data), mode="r:gz") as control:
        text = read_member(control, "control").decode()
        scripts = {
            "postinst": '#!/bin/sh\n[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0\n'
                        '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0\n'
                        '. ${IPKG_INSTROOT}/lib/functions.sh\ndefault_postinst $0 $@\n',
            "prerm": '#!/bin/sh\n[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0\n'
                     '. ${IPKG_INSTROOT}/lib/functions.sh\ndefault_prerm $0 $@\n',
        }
        for name in ("preinst", "postinst", "prerm", "postrm"):
            definition = re.search(r"^define Package/[^/\n]+/" + name + r"\n(.*?)\nendef$",
                                   makefile, re.M | re.S)
            if definition:
                body = re.sub(r"\\\n\t*", "", definition.group(1)).replace("$$", "$") + "\n"
                scripts[name + "-pkg" if name in ("postinst", "prerm") else name] = body
        allowed = {"control", "conffiles", *scripts}
        require(all(item.isdir() or (item.isfile() and item.name.removeprefix("./") in allowed)
                    for item in control.getmembers()), "unexpected IPK control member")
        for name, expected in scripts.items():
            require(read_member(control, name) == expected.encode(), f"installation script drift: {name}")
    fields = dict(line.split(": ", 1) for line in text.splitlines()
                  if ": " in line and not line.startswith(" "))
    return fields, data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packages-dir", type=Path, required=True)
    parser.add_argument("--feed-dir", type=Path, required=True)
    parser.add_argument("--core-arch", choices=("x86_64", "aarch64", "armv7"), required=True)
    parser.add_argument("--package-arch", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    pins = dict(line.split("=", 1) for line in (root / "ci/pins-linux66.env").read_text().splitlines()
                if line and not line.startswith("#"))
    stage = (args.feed_dir / "honk/generated-stage.mk").read_text()
    assignments = dict(re.findall(r"^([A-Z0-9_]+):=(.*)$", stage, re.M))
    suffix = args.core_arch.upper()
    archive_name = assignments[f"HONK_ASSET_{suffix}"]
    require(Path(archive_name).name == archive_name, "invalid core archive name")
    archive_path = args.feed_dir / "dl" / archive_name
    require(hashlib.sha256(archive_path.read_bytes()).hexdigest() == assignments[f"HONK_HASH_{suffix}"],
            "core archive digest mismatch")
    with tarfile.open(archive_path, "r:gz") as archive:
        expected_binary = read_member(archive, f"{archive_name.removesuffix('.tar.gz')}/honk-core")
    expected_provenance = json.loads((args.feed_dir / "honk/generated-provenance.json").read_text())
    selected = {}
    manifest = {"experimental": True, "sdk": "24.10", "package_arch": args.package_arch,
                "runtime_validation": "not performed by this workflow", "packages": {}}
    for package in ("honk", "luci-app-honk"):
        paths = list(args.packages_dir.glob(f"{package}_*.ipk"))
        require(len(paths) == 1, f"expected exactly one {package} IPK")
        makefile = (args.feed_dir / package / "Makefile").read_text()
        fields, data = read_ipk(paths[0], makefile)
        require(fields.get("Package") == package, f"wrong package identity: {paths[0].name}")
        expected_arch = args.package_arch if package == "honk" else "all"
        require(fields.get("Architecture") == expected_arch, f"wrong package architecture: {package}")
        version = re.search(r"^PKG_VERSION:=(.+)$", makefile, re.M).group(1).strip()
        release = re.search(r"^PKG_RELEASE:=(.+)$", makefile, re.M).group(1).strip()
        require(re.fullmatch(re.escape(version) + r"-(?:r)?" + re.escape(release),
                             fields.get("Version", "")), f"package version drift: {package}")
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as payload:
            require(not any("tests" in Path(item.name).parts for item in payload.getmembers()),
                    f"local tests included in {package}")
            if package == "honk":
                binary = read_member(payload, "usr/bin/honk-core")
                capabilities = json.loads(read_member(payload, "usr/share/honk/core-capabilities.json"))
                provenance = json.loads(read_member(payload, "usr/share/honk/provenance.json"))
                digest = hashlib.sha256(binary).hexdigest()
                require(binary == expected_binary, "SDK changed the source archive core")
                require(provenance == expected_provenance, "SDK changed the source provenance")
                require(capabilities.get("lane") == "linux66", "not a compatibility core")
                require(capabilities.get("minimum_kernel") == pins["CORE_MIN_KERNEL"], "kernel floor drift")
                require(capabilities.get("core_sha256") == digest, "SDK changed the core payload")
                elf_class, machine = {"x86_64": (2, 62), "aarch64": (2, 183),
                                      "armv7": (1, 40)}[args.core_arch]
                require(binary[:4] == b"\x7fELF" and binary[4:6] == bytes((elf_class, 1))
                        and int.from_bytes(binary[18:20], "little") == machine, "wrong core ELF architecture")
                core = provenance["core"]
                require(core.get("lane") == "linux66" and core.get("commit") == pins["CORE_COMMIT"]
                        and core.get("repository") == pins["CORE_REPOSITORY"], "core source drift")
                require(core.get("architectures") == [args.core_arch], "core architecture provenance drift")
                require(core.get("compatibility_patch_sha256") == pins["CORE_COMPAT_PATCH_SHA256"],
                        "compatibility patch drift")
                expected_config = hashlib.sha256((root / "ci/patches/honk-core-config-validate.patch").read_bytes()).hexdigest()
                require(core.get("configuration_patch_sha256") == expected_config, "configuration patch drift")
                sources = [(args.feed_dir / "honk/files/honk.init", "etc/init.d/honk")]
                sources += [(path, f"usr/share/honk/{path.name}")
                            for path in (args.feed_dir / "honk/files").glob("*.sh")]
                manifest["core"] = {"sha256": digest, "capabilities": capabilities, "provenance": provenance}
            else:
                dependencies = [part.strip().split()[0] for part in fields.get("Depends", "").split(",") if part.strip()]
                require("honk" in dependencies, "LuCI core dependency is missing")
                sources = [(args.feed_dir / package / "root" / path, path) for path in (
                    "usr/libexec/rpcd/honk", "usr/share/luci-app-honk/pkg-info.sh",
                    "usr/share/luci-app-honk/update-pkg.sh")]
            for source, destination in sources:
                require(read_member(payload, destination) == source.read_bytes(), f"script payload drift: {destination}")
        selected[package] = paths[0]
        manifest["packages"][package] = {"filename": paths[0].name, "version": fields["Version"],
                                         "architecture": fields["Architecture"]}

    args.output_dir.mkdir(parents=True, exist_ok=False)
    for path in selected.values():
        shutil.copyfile(path, args.output_dir / path.name)
    (args.output_dir / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")
    sums = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
            for path in sorted(args.output_dir.iterdir()) if path.is_file()]
    (args.output_dir / "SHA256SUMS").write_text("".join(sums))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
