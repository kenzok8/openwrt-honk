<h1 align="center">openwrt-honk</h1>

<p align="center">OpenWrt x86_64 透明代理一体包：<b>honk</b> 核心 + <b>Doona</b> Web 界面 + <b>luci-app-honk</b> 管理界面。</p>

## 界面预览

<table>
<tr>
<td align="center"><b>概览</b><br><img width="420" src="https://raw.githubusercontent.com/kenzok8/kenzok8/main/screenshot/honk/honk-overview.png"></td>
<td align="center"><b>配置</b><br><img width="420" src="https://raw.githubusercontent.com/kenzok8/kenzok8/main/screenshot/honk/honk-configuration.png"></td>
</tr>
<tr>
<td align="center"><b>维护</b><br><img width="420" src="https://raw.githubusercontent.com/kenzok8/kenzok8/main/screenshot/honk/honk-maintenance.png"></td>
<td align="center"><b>Doona 核心界面</b><br><img width="420" src="https://raw.githubusercontent.com/kenzok8/kenzok8/main/screenshot/honk/honk-doona.png"></td>
</tr>
</table>

## 关于 Honk

- **honk** —— 基于 eBPF 的高性能透明代理核心（dae 风格的 Rust 重写），流量在内核态分流，直连流量几乎零开销，适合做软路由主力代理。
- **luci-app-honk** —— LuCI 管理界面：概览、配置（订阅 / 粘贴节点 / dae 导入）、日志、维护（Geo 数据更新、软件包升级、配置备份、系统检查）。
- **Doona** —— 核心自带 Web 界面（随 LuCI 包安装到 `/usr/share/doona`），管理节点、分组、路由、DNS 与订阅，不另起服务。

## 支持范围

honk 的 eBPF 数据面要求 **Linux 6.12+**：24.10 及更早（内核 6.6 / 5.15）装上也起不来，所以只发 **OpenWrt / ImmortalWrt 25.12** 的包，安装脚本会先查内核版本，低于 6.12 直接退出。

| 架构 | 状态 |
| :--- | :--- |
| `x86_64` | 主力支持（软路由） |
| `aarch64_cortex-a53` · `aarch64_cortex-a72` · `aarch64_cortex-a76` · `aarch64_generic` | 支持，ARM64 设备（含树莓派 5 等 a76 设备） |
| `arm_cortex-a7_neon-vfpv4` · `arm_cortex-a9` | 实验性：25.12 内核满足 6.12，但上游只发 x86_64/aarch64，这两个由源码交叉编译，尚未做真机验证 |

安装包只提供 `.apk`（25.12 起 OpenWrt 换用 apk），不再提供 `.ipk`。

## 包含什么

- `honk` —— honk-core 二进制 + 服务脚本 + 默认配置
- `luci-app-honk` —— LuCI 界面 + 中文翻译（直接编译进主包）+ Doona 资产
- Geo 数据由 `v2ray-geoip` / `v2ray-geosite` 提供，Honk 与 daede 共用 `/usr/share/v2ray`；可在维护页手动更新或定时更新

## 一键安装

```bash
# 大陆推荐：jsDelivr 镜像，比 ghfast 之类的加速站稳定
wget -O - https://cdn.jsdelivr.net/gh/kenzok8/openwrt-honk@main/scripts/install.sh | ash
```

```bash
# 直连 GitHub（镜像还没同步到最新脚本时用）
wget -O - https://raw.githubusercontent.com/kenzok8/openwrt-honk/refs/heads/main/scripts/install.sh | ash
```

> jsDelivr 对 `@main` 有缓存（最长约 12 小时），刚改过的脚本可能延迟生效；
> 脚本执行时仍会自己去 GitHub 取最新 Release，装到的版本不受影响。
> 安装包下载默认走 `GH_PROXY`（默认 `https://ghfast.top/`），失败会自动回落到直连 GitHub；
> 想换加速站可以 `GH_PROXY=https://你的加速站/ wget -O - ... | ash`。

卸载：

```bash
wget -O - https://cdn.jsdelivr.net/gh/kenzok8/openwrt-honk@main/scripts/uninstall.sh | ash
```

> 一键脚本会复用设备已有的 Geo 数据包；缺少时从聚合源下载，下载失败则尝试设备现有软件源。

## 使用

安装 `honk` 和 `luci-app-honk` 后，在 LuCI「服务 → Honk」中初始化服务，运行系统检查并启动。核心 Web 界面（Doona）仅在已初始化、正在运行且 API 就绪时开放。

节点与订阅直接写入 `/etc/honk/config.dae`（`node { label: 'share-link' }` 或 `subscription { tag: 'url' }`），重载 Honk 后生效；路由、DNS 与订阅也可在 Doona 面板中管理。

管理入口和 API 只应在可信 LAN 内使用。若 LuCI 通过未加密的 HTTP 提供，浏览器到路由器间的登录信息和 API 流量没有传输加密保护；请勿将管理页面暴露到互联网。

## 固定源码与构建

核心和 Doona 的完整提交、Doona OpenWrt 补丁摘要，以及 OpenWrt 25.12.4 x86/64 官方 SDK 地址和 SHA256 均固定在 `ci/pins.env`。Doona 从源码构建，保留 OpenWrt 同源 API 补丁；归档不含可选中文字体，浏览器使用系统字体。构建脚本从固定输入生成静态 UI、stock musl 核心和安装包。

`auto-bump.yml` 每 6 小时检查上游。发现新提交后，它在独立分支写入 pin、包版本和 Doona 归档哈希，启动 `release.yml` 构建核心、Doona 和全部 12 组 SDK 安装包。任一组失败就停止晋级；全部通过后，自动将经过验证的提交和正式 tag 原子推送到 `main`，发布正式 Release，并更新 R2 软件源。每次构建的源码资产使用独立 tag；候选构建不会更新生产软件源。正式发布后的 Release 或 R2 上传若失败，工作流会报错，需用同批构建产物恢复。

完整构建（包括核心构建）需在大小写敏感的 Linux 文件系统上运行（Doona 上游同时有仅大小写不同的文件）。需要 Rust/rustup、Zig 0.14.1、Node.js 22.13 或更新版本与 Corepack、Git、curl、ripgrep、GNU tar、zstd、`readelf`，以及 `build-essential`、clang、LLVM、libbpf、libelf、pkg-config、CMake、libclang 和 OpenWrt SDK 所需工具。核心交叉编译脚本会核对 Rust/Doona/SDK 输入和 Zig、bpf-linker 版本；SDK 阶段限定 Linux x86_64。

在满足工具要求的 Linux 环境中按顺序运行：

```sh
bash scripts/check.sh
ci/build-doona.sh
ci/build-core.sh
```

脚本将源码归档写入被 Git 忽略的 `artifacts/cache/`。7 组 SDK 安装包（7 架构 × SDK 25.12）由 `release.yml` 构建；它从本次运行独立的源码资产 tag 下载带 SHA256 的阶段文件，任一散列不匹配或安装包缺失都会使构建失败。

## 依赖

| 包名 | 说明 |
|------|------|
| `ca-bundle` | CA 证书包 |
| `kmod-sched-core` / `kmod-sched-bpf` | eBPF 流量调度 |
| `kmod-veth` | 虚拟以太网设备 |
| `kmod-nft-queue` | nftables 队列 |
| `v2ray-geoip` / `v2ray-geosite` | 路由 GeoIP/GeoSite 数据 |
| `rpcd` / `luci-base` / `cgi-io` | LuCI 运行依赖 |

内核需要 BTF（`/sys/kernel/btf/vmlinux`），honk-core 用 CO-RE eBPF，缺少 BTF 会启动失败。

## 系统要求

- OpenWrt x86_64（推荐 25.x，需 Linux 6.12+ 且内核开启 BTF）

## 致谢

- [honk](https://github.com/Glassyiris/honk) — eBPF 透明代理核心
- [doona](https://github.com/Zakkaus/doona) — 核心 Web 界面

## 许可证

本仓库原创集成文件采用 GPL-3.0-only。Honk 核心与 Doona 各自保留上游许可和第三方声明；打包时随软件安装至 `/usr/share/licenses/`。核心提交、Doona 提交、补丁摘要及实际阶段归档散列记录在构建生成的 provenance 文件中。
