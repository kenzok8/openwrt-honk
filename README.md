<p align="center"><img src="docs/site/assets/logo.png" width="96" height="96" alt="Honk"></p>

<h1 align="center">openwrt-honk</h1>

<p align="center">OpenWrt / ImmortalWrt 25.12 透明代理一体包（内核 6.12+，7 架构 APK）<br><b>honk</b> 核心 + <b>Doona</b> Web 界面 + <b>luci-app-honk</b> 管理界面</p>

<div align="center">
  <a href="https://github.com/kenzok8/openwrt-honk/releases"><img alt="Release" src="https://img.shields.io/github/v/release/kenzok8/openwrt-honk?style=flat-square&label=release"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/kenzok8/openwrt-honk/total?style=flat-square&label=downloads"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/kenzok8/openwrt-honk/main?style=flat-square"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/kenzok8/openwrt-honk?style=flat-square"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/issues?q=is%3Aissue+is%3Aclosed"><img alt="Closed issues" src="https://img.shields.io/github/issues-closed/kenzok8/openwrt-honk?style=flat-square"></a>
  <a href="https://github.com/kenzok8/openwrt-honk/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/kenzok8/openwrt-honk?style=flat-square"></a>
</div>


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

## 这是什么

| 组件 | 说明 |
| :--- | :--- |
| **honk** | 基于 eBPF 的透明代理核心，dae 风格的 Rust 重写。流量在内核态分流，直连流量几乎零开销，适合做软路由主力代理 |
| **luci-app-honk** | LuCI 管理界面：概览、配置（订阅 / 粘贴节点 / dae 导入）、日志、维护（Geo 数据、软件包升级、配置备份、系统检查） |
| **Doona** | 核心自带 Web 界面，随 LuCI 包安装到 `/usr/share/doona`，管理节点、分组、路由、DNS 与订阅，不另起服务 |

## 支持范围

| 架构 | 状态 |
| :--- | :--- |
| `x86_64` | 主力支持（软路由） |
| `aarch64_cortex-a53` · `aarch64_cortex-a72` · `aarch64_cortex-a76` · `aarch64_generic` | 支持，ARM64 设备（含树莓派 5 等 a76 设备） |
| `arm_cortex-a7_neon-vfpv4` · `arm_cortex-a9` | 实验性：25.12 内核满足 6.12，但上游只发 x86_64 / aarch64，这两个由源码交叉编译，尚未做真机验证 |

- eBPF 数据面要求 **Linux 6.12+**，24.10 及更早（6.6 / 5.15）装上也起不来，所以只发 **OpenWrt / ImmortalWrt 25.12** 的包；安装脚本会先查内核，低于 6.12 直接退出。
- 25.12 起 OpenWrt 换用 apk，这里只提供 `.apk`，不再提供 `.ipk`。

## 安装

```bash
# 大陆推荐：jsDelivr 镜像，比 ghfast 之类的加速站稳定
wget -O - https://cdn.jsdelivr.net/gh/kenzok8/openwrt-honk@main/scripts/install.sh | ash
```

```bash
# 直连 GitHub：镜像还没同步到最新脚本时用
wget -O - https://raw.githubusercontent.com/kenzok8/openwrt-honk/refs/heads/main/scripts/install.sh | ash
```

> - jsDelivr 对 `@main` 有缓存（最长约 12 小时），刚改过的脚本可能延迟生效；脚本执行时仍会去 GitHub 取最新 Release，装到的版本不受影响。
> - 安装包下载默认走 `GH_PROXY`（`https://ghfast.top/`），失败自动回落直连 GitHub。换加速站：`GH_PROXY=https://你的加速站/ wget -O - ... | ash`。
> - 脚本会复用设备已有的 Geo 数据包；缺少时从聚合源下载，失败则用设备现有软件源。

装了什么：

- `honk` —— honk-core 二进制 + 服务脚本 + 默认配置
- `luci-app-honk` —— LuCI 界面 + 中文翻译（编译进主包）+ Doona 资产
- Geo 数据来自 `v2ray-geoip` / `v2ray-geosite`，与 daede 共用 `/usr/share/v2ray`，可在维护页手动或定时更新

### 卸载

```bash
wget -O - https://cdn.jsdelivr.net/gh/kenzok8/openwrt-honk@main/scripts/uninstall.sh | ash
```

## 升级

两条路，选一条即可。

**① 重跑安装脚本**（不用配软件源，最稳）

```bash
wget -O - https://cdn.jsdelivr.net/gh/kenzok8/openwrt-honk@main/scripts/install.sh | ash
```

**② 加软件源**，之后在 LuCI「服务 → Honk → 维护 → 软件包更新」里点升级

```bash
wget -qO- https://down.dllkids.xyz/openwrt-feed/openwrt-feed-setup.sh | sh
```

> 「软件包更新」卡片只查本机 apk/opkg 源，不查 GitHub。用安装脚本装的机器没有把 feed 写进源，卡片会一直显示「已是最新」；先跑上面这条软件源脚本（装公钥 + 写源 + 刷索引）卡片才有用。
> 刚发布的版本要等 feed 同步过去才会进索引，急着升级直接重跑安装脚本。

## 使用

在 LuCI「服务 → Honk」初始化服务，运行系统检查后启动。Doona 界面仅在已初始化、正在运行且 API 就绪时开放。

节点与订阅直接写进 `/etc/honk/config.dae`（`node { label: 'share-link' }` 或 `subscription { tag: 'url' }`），重载 Honk 后生效；路由、DNS 与订阅也可以只在 Doona 面板里管。

> 管理入口和 API 只应在可信 LAN 内使用。若 LuCI 走未加密的 HTTP，浏览器到路由器之间的登录信息和 API 流量没有传输加密，请勿把管理页面暴露到互联网。

## 依赖

| 包名 | 说明 |
| :--- | :--- |
| `ca-bundle` | CA 证书包 |
| `kmod-sched-core` / `kmod-sched-bpf` | eBPF 流量调度 |
| `kmod-veth` | 虚拟以太网设备 |
| `kmod-nft-queue` | nftables 队列 |
| `v2ray-geoip` / `v2ray-geosite` | 路由 GeoIP / GeoSite 数据 |
| `rpcd` / `luci-base` / `cgi-io` | LuCI 运行依赖 |

## 内核 BTF

honk-core 用 CO-RE eBPF，缺 BTF 起不来。查找顺序与核心一致：

1. `HONK_VMLINUX_BTF` 指定的文件 —— 设了它就只认这一个，读不到直接拒绝启动，不回退。
2. `/sys/kernel/btf/vmlinux` —— 内核自带 BTF 的固件有（如 ImmortalWrt）。
3. `/usr/lib/debug/boot/vmlinux` —— [vmlinux-btf](https://github.com/kenzok8/vmlinux-btf) 装的就是这里，官方 OpenWrt 走这条。

补充说明：

- 安装脚本发现两条默认路径都没有时，会从软件源补装 `vmlinux-btf`：主次版本一致就装，补丁号不同照装但打警告，跨系列跳过。
- 自编译或快照内核没有现成包，拿同一次编译的 `vmlinux` 跑 `pahole --btf_encode_detached=vmlinux.btf vmlinux`，放到 `/usr/lib/debug/boot/vmlinux`，或用 `HONK_VMLINUX_BTF` 指过去。
- 只有内核自带 BTF 时才启用「原生 UDP 接收追踪」，用外部 BTF 时该功能降级，其余功能不受影响。

## 构建与发布

**固定输入。** 核心和 Doona 的完整提交、Doona OpenWrt 补丁摘要、OpenWrt 25.12.4 x86/64 官方 SDK 地址和 SHA256 都固定在 `ci/pins.env`。Doona 从源码构建并保留 OpenWrt 同源 API 补丁，归档不含可选中文字体，浏览器用系统字体。

**自动更新。** 核心跟官方 `main` 的最新提交（eBPF nightly 从上游源码读，不写死）。`auto-bump.yml` 每 6 小时检查官方 `main` 与 Doona 更新，在独立分支写入 pin、包版本和归档哈希，构建核心、Doona 和全部 7 组 SDK 安装包，**只产出候选 Release**；真机复测通过后以 `auto_publish` 推进，原子更新 `main`、正式 tag、Release 与 R2 软件源。

**构建环境。** 完整构建（含核心）需在大小写敏感的 Linux 文件系统上跑（Doona 上游有仅大小写不同的文件）。需要 Rust / rustup、Zig 0.14.1、Node.js 22.13+ 与 Corepack、Git、curl、ripgrep、GNU tar、zstd、`readelf`，以及 `build-essential`、clang、LLVM、libbpf、libelf、pkg-config、CMake、libclang 和 OpenWrt SDK 所需工具。核心交叉编译脚本会核对 Rust / Doona / SDK 输入与 Zig、bpf-linker 版本；SDK 阶段限定 Linux x86_64。

```sh
bash scripts/check.sh
ci/build-doona.sh
ci/build-core.sh
```

源码归档写入被 Git 忽略的 `artifacts/cache/`。7 组 SDK 安装包（7 架构 × SDK 25.12）由 `release.yml` 构建，它从本次运行独立的源码资产 tag 下载带 SHA256 的阶段文件，任一散列不匹配或安装包缺失都会使构建失败。

## 致谢

- [honk](https://github.com/daeuniverse/honk) —— eBPF 透明代理核心
- [doona](https://github.com/Zakkaus/doona) —— 核心 Web 界面

## 许可证

本仓库原创集成文件采用 GPL-3.0-only。Honk 核心与 Doona 各自保留上游许可和第三方声明，打包时随软件安装至 `/usr/share/licenses/`。核心提交、Doona 提交、补丁摘要及实际阶段归档散列记录在构建生成的 provenance 文件中。
