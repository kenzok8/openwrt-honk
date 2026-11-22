<p align="center"><img src="docs/site/assets/logo.png" width="96" height="96" alt="Honk"></p>

<h1 align="center">openwrt-honk</h1>

<p align="center">All-in-one transparent proxy for OpenWrt / ImmortalWrt 25.12 (kernel 6.12+, 7-arch APK)<br><b>honk</b> core + <b>Doona</b> web UI + <b>luci-app-honk</b> admin interface</p>

<p align="center">English · <a href="README.md">中文</a></p>

<div align="center">
  <a href="https://github.com/kenzok8/openwrt-honk/releases"><img alt="Release" src="https://img.shields.io/github/v/release/kenzok8/openwrt-honk?style=flat-square&label=release"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/kenzok8/openwrt-honk/total?style=flat-square&label=downloads"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/kenzok8/openwrt-honk/main?style=flat-square"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/kenzok8/openwrt-honk?style=flat-square"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/issues?q=is%3Aissue+is%3Aclosed"><img alt="Closed issues" src="https://img.shields.io/github/issues-closed/kenzok8/openwrt-honk?style=flat-square"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/kenzok8/openwrt-honk?style=flat-square"></a>
</div>

## Screenshots

<table>
<tr>
<td align="center"><b>Overview</b><br><img width="420" src="https://raw.githubusercontent.com/kenzok8/kenzok8/main/screenshot/honk/honk-overview.png"></td>
<td align="center"><b>Configuration</b><br><img width="420" src="https://raw.githubusercontent.com/kenzok8/kenzok8/main/screenshot/honk/honk-configuration.png"></td>
</tr>
<tr>
<td align="center"><b>Maintenance</b><br><img width="420" src="https://raw.githubusercontent.com/kenzok8/kenzok8/main/screenshot/honk/honk-maintenance.png"></td>
<td align="center"><b>Doona core UI</b><br><img width="420" src="https://raw.githubusercontent.com/kenzok8/kenzok8/main/screenshot/honk/honk-doona.png"></td>
</tr>
</table>

## What is this

| Component | Description |
| :--- | :--- |
| **honk** | An eBPF-based transparent proxy core, a Rust rewrite in the style of dae. Traffic is split in kernel space, so direct traffic costs almost nothing — a good fit as the main proxy on a software router |
| **luci-app-honk** | LuCI admin interface: overview, configuration (subscriptions / pasted nodes / dae import), logs, maintenance (Geo data, package updates, config backup, system checks) |
| **Doona** | The core's built-in web UI, installed with the LuCI package to `/usr/share/doona`. Manages nodes, groups, routing, DNS and subscriptions without starting another service |

## Supported targets

| Architecture | Status |
| :--- | :--- |
| `x86_64` | Primary support (software routers) |
| `aarch64_cortex-a53` · `aarch64_cortex-a72` · `aarch64_cortex-a76` · `aarch64_generic` | Supported, ARM64 devices (including Raspberry Pi 5 and other a76 devices) |
| `arm_cortex-a7_neon-vfpv4` · `arm_cortex-a9` | Experimental: the 25.12 kernel meets 6.12, but upstream only ships x86_64 / aarch64, so these are cross-compiled from source and have not been verified on real hardware yet |

- The stable release requires **Linux 6.12+** and targets **OpenWrt / ImmortalWrt 25.12**, shipped as `.apk`; the install script checks the kernel first.
- **24.10** goes through the experimental Linux 6.6 lane, shipped as `.ipk`, kernel 6.6.40+ required — see below.
- Building your own firmware: kernel options, required modules and common build errors are covered in [Build firmware](https://kenzok8.github.io/openwrt-honk/build-firmware.html).

<details>
<summary><b>Experimental Linux 6.6 lane (24.10)</b></summary>

The compatible core is based on the [kernel-floor-6.6 branch of 6106757-lab/honk](https://github.com/6106757-lab/honk/tree/kernel-floor-6.6) and inherits that branch's features and limits. The branch is tracked daily and repackaged only when it moves; the pinned commit and a summary of the OpenWrt integration patches live in [ci/pins-linux66.env](ci/pins-linux66.env), independent of the stable lane.

- Minimum kernel `6.6.40`. Official OpenWrt 24.10.8 (kernel 6.6.144) has passed install, start/stop, reboot, upgrade and real-traffic verification; a successful build on other architectures does not mean they have been verified on hardware.
- The compatible package reuses the same LuCI and Doona; the overview page shows "Linux 6.6 experimental". It needs matching kernel modules plus BTF that is either built into the kernel or an external file matching `uname -r` exactly.
- Releases go out as a separate prerelease (tag follows the package version, e.g. `linux66-2026.11.18.1`) and `openwrt-feed/honk/24.10/<arch>/`, with the opkg index generated and signed by the aggregate workflow; `linux66.yml` tracks the upstream branch daily and builds and publishes on new commits; manual runs only publish when `publish` is checked.
- LuCI one-click upgrades stay within the same lane; cross-lane upgrades are rejected. Config backups cannot be restored across lanes (restore reports `incompatible_core_version`) — move the `node {}` blocks by hand when switching lanes.
- Known limits: UDP session capacity depends on the file-descriptor and memory budget (local testing with `nofile=4096` topped out around 168 sessions; packets drop at the cap and recover as idle sessions are reclaimed); without kprobe BPF in the kernel, UDP kernel-path observation degrades and external BTF cannot make up for it; a continuous rule-reload test in an AArch64 emulated environment showed brief UDP packet loss.

Local build (on a Linux x86_64 build machine):

```bash
CORE_LANE=linux66 CORE_ARCHS=x86_64 bash ci/build-core.sh
python3 ci/prepare-linux66-package.py
```

Core archives and compatibility info go to `artifacts/cache/` and `honk/generated-linux66-*`; the experimental package sources are prepared in `artifacts/linux66-package/`. Copy its `dl/` into the 24.10 SDK's `dl/`, then build `honk` and `luci-app-honk`. This flow is for local verification; no public release version has been assigned to it yet.

Before replacing or removing an experimental package, stop the service in LuCI and confirm it has stopped, then use the package manager.

</details>

## Install

```bash
# Recommended in mainland China: jsDelivr mirror, more stable than ghfast-style accelerators
wget -O - https://cdn.jsdelivr.net/gh/kenzok8/openwrt-honk@main/scripts/install.sh | ash
```

```bash
# Direct GitHub: use when the mirror has not synced the latest script yet
wget -O - https://raw.githubusercontent.com/kenzok8/openwrt-honk/refs/heads/main/scripts/install.sh | ash
```

> - jsDelivr caches `@main` (up to about 12 hours), so a freshly changed script may take effect late; the script still fetches the latest release from GitHub when it runs, so the installed version is unaffected.
> - Package downloads go through `GH_PROXY` (`https://ghfast.top/`) by default and fall back to direct GitHub on failure. To use another accelerator: `GH_PROXY=https://your-mirror/ wget -O - ... | ash`.
> - The script reuses Geo data already on the device; when missing, it downloads from the aggregate feed, or falls back to the device's existing software feeds.

What gets installed:

- `honk` — honk-core binary + service scripts + default configuration
- `luci-app-honk` — LuCI interface + Chinese translation (built into the main package) + Doona assets
- Geo data comes from `v2ray-geoip` / `v2ray-geosite`, sharing `/usr/share/v2ray` with daede; it can be updated manually or on a schedule from the maintenance page

### Uninstall

```bash
wget -O - https://cdn.jsdelivr.net/gh/kenzok8/openwrt-honk@main/scripts/uninstall.sh | ash
```

## Upgrade

Two ways — pick one.

**① Re-run the install script** (no feed setup needed, most reliable)

```bash
wget -O - https://cdn.jsdelivr.net/gh/kenzok8/openwrt-honk@main/scripts/install.sh | ash
```

**② Add the software feed**, then upgrade from LuCI under Services → Honk → Maintenance → Package update

```bash
wget -qO- https://down.dllkids.xyz/openwrt-feed/openwrt-feed-setup.sh | sh
```

> The "Package update" card only checks the local apk/opkg feeds, not GitHub. A machine installed with the script has no feed configured, so the card always shows "up to date"; run the feed setup script above first (installs the public key, writes the feed, refreshes the index) for the card to work.
> A just-published release only appears in the index after the feed syncs; to upgrade immediately, re-run the install script.

## Usage

Initialize the service under LuCI → Services → Honk, run the system check, then start it. The Doona UI only opens once the service is initialized, running, and the API is ready.

A fresh install uses a complete `/etc/honk/config.dae` with `global`, `experimental`, nodes, routing and DNS. The LAN, port and Clash API options on the overview page are only for first-time setup; after initialization, edit the configuration on the config page — starting and repairing never rebuild those fields from old UCI values.

Upgrades keep a modified main config and `system.dae`; users still referencing `system.dae` can preview the merge in the config editor and apply it only after confirming. In one edge case (package installed, setup completed, service never started), the old main config may be replaced by the package default — the `honk` package's upgrade hooks save the old config to `/etc/.honk-preupgrade/` first and write it back unchanged after confirming no core is running; a failed write-back rolls back and logs the error.

Write nodes and subscriptions directly into `/etc/honk/config.dae` (`node { label: 'share-link' }` or `subscription { tag: 'url' }`); they take effect after reloading Honk. Routing, DNS and subscriptions can also be managed in the Doona panel alone.

The Clash API secret lives in its own file, `/etc/honk/secrets.dae`, which the main config only includes. The core decides writability per file: if a file contains a `secret` field in a `native_api` / `clash_api` block (an empty value counts), the whole config becomes read-only to panels, and Doona cannot add subscriptions or nodes. Pasting a config that carries its own secret migrates it automatically, and the first start after an upgrade migrates once as well; the old file is kept at `/etc/honk/config-before-secrets.dae`.

> Management pages and APIs should only be used on a trusted LAN. If LuCI runs over unencrypted HTTP, login credentials and API traffic between the browser and the router have no transport encryption — never expose the admin pages to the internet.

## Dependencies

| Package | Description |
| :--- | :--- |
| `ca-bundle` | CA certificate bundle |
| `ip-full` | Full iproute2, used by the service scripts to bring interfaces up and down |
| `kmod-sched-core` / `kmod-sched-bpf` | eBPF traffic scheduling |
| `kmod-veth` | Virtual Ethernet devices |
| `kmod-nft-queue` | nftables queue |
| `v2ray-geoip` / `v2ray-geosite` | GeoIP / GeoSite routing data |
| `ubus` / `jsonfilter` / `jshn` | Service-script communication and JSON handling |
| `sqlite3-cli` | State database integrity checks |
| `usign` | Update manifest signature verification |
| `coreutils-stat` | File permission checks (`stat -c`) |
| `rpcd` / `luci-base` / `cgi-io` | LuCI runtime dependencies |

See `honk/Makefile` and `luci-app-honk/Makefile` for the full dependency lists.

## Kernel BTF

honk-core uses CO-RE eBPF and cannot start without BTF. The lookup order matches the core:

1. The file named by `HONK_VMLINUX_BTF` — when set, only this one is accepted; if it cannot be read, startup is refused with no fallback.
2. `/sys/kernel/btf/vmlinux` — present on firmware with built-in BTF (e.g. ImmortalWrt).
3. `/usr/lib/debug/boot/vmlinux` — where [vmlinux-btf](https://github.com/kenzok8/vmlinux-btf) installs; official OpenWrt uses this path.

- When the install script finds neither default path, it installs a matching `vmlinux-btf` for the running kernel: directly from the feed when the current kernel version is there, otherwise the same version from [vmlinux-btf releases](https://github.com/kenzok8/vmlinux-btf/releases/tag/latest) by `uname -r` (the feed keeps only the latest build, so it stops matching once the kernel changes); only when both are missing does it print a warning. A package from the same series with a different patch number is still installed, with a warning.
- For self-built or snapshot kernels with no ready package: run `pahole --btf_encode_detached=vmlinux.btf vmlinux` on the `vmlinux` from the same build, place it at `/usr/lib/debug/boot/vmlinux`, or point `HONK_VMLINUX_BTF` at it.
- "Native UDP receive tracing" is only enabled with built-in kernel BTF; with external BTF that feature degrades, everything else is unaffected.

## Build & release

**Pinned inputs.** The full core and Doona commits and the Doona OpenWrt patch digest are pinned in `ci/pins.env`. The SDK comes from the ImmortalWrt SDK container (`<arch>-openwrt-25.12`) pulled by `kenzok8/gh-action-sdk`, and the build records the SDK identity in `sdk-info.txt`. Doona is built from source with the OpenWrt same-origin API patch kept; the archive omits the optional Chinese font files and browsers use the system font.

**Auto-updates.** The core follows official `v*` tags (the eBPF nightly is read from upstream source, not hardcoded) and Doona follows its version number. `auto-bump.yml` checks daily: only when a new official tag appears or the Doona version changes does it write pins, package versions and archive hashes to a separate branch and build all 7 SDK package sets; a fully green matrix is pushed straight to `main`, a formal tag, a release and the R2 feed, while any SDK failure leaves only the candidate branch and never touches the formal feed.

**Build environment.** A full build (including the core) must run on a case-sensitive Linux filesystem (Doona upstream has files that differ only by case). You need Rust / rustup, Zig 0.14.1, Node.js 22.13+ with Corepack, Git, curl, ripgrep, GNU tar, zstd and `readelf`, plus `build-essential`, clang, LLVM, libbpf, libelf, pkg-config, CMake, libclang and the tools the OpenWrt SDK needs. The core cross-build script verifies the Rust / Doona / SDK inputs and the Zig and bpf-linker versions; the SDK stage only runs on Linux x86_64.

```sh
bash scripts/check.sh
ci/build-doona.sh
ci/build-core.sh
```

Source archives go to the git-ignored `artifacts/cache/`. The 7 SDK package sets (7 architectures × SDK 25.12) are built by `release.yml`, which downloads SHA256-tagged stage files from the run's own source-asset tag; any hash mismatch or missing package fails the build.

## Credits

- [honk](https://github.com/daeuniverse/honk) — eBPF transparent proxy core
- [doona](https://github.com/Zakkaus/doona) — core web UI

## License

Original integration files in this repo are GPL-3.0-only. The Honk core and Doona keep their upstream licenses and third-party notices, installed with the software under `/usr/share/licenses/`. Core and Doona commits, patch digests and the actual stage archive hashes are recorded in the provenance file generated at build time.
