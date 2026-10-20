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

## 包含什么

- `honk` —— honk-core 二进制 + 服务脚本 + 默认配置
- `luci-app-honk` —— LuCI 界面 + 中文翻译（直接编译进主包）+ Doona 资产
- Geo 数据由 `v2ray-geoip` / `v2ray-geosite` 提供，Honk 与 daede 共用 `/usr/share/v2ray`；可在维护页手动更新或定时更新

## 一键安装

```bash
wget -O - https://raw.githubusercontent.com/kenzok8/openwrt-honk/refs/heads/main/scripts/install.sh | ash
```

大陆网络加速：

```bash
wget --no-check-certificate -O - https://ghfast.top/https://raw.githubusercontent.com/kenzok8/openwrt-honk/refs/heads/main/scripts/install.sh | ash
```

卸载：

```bash
wget -O - https://raw.githubusercontent.com/kenzok8/openwrt-honk/refs/heads/main/scripts/uninstall.sh | ash
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

脚本将源码归档写入被 Git 忽略的 `artifacts/cache/`。12 组 SDK 安装包由 `release.yml` 构建；它从本次运行独立的源码资产 tag 下载带 SHA256 的阶段文件，任一散列不匹配或安装包缺失都会使构建失败。

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

## 分支说明：`main` 与 `mydist`

| 分支 | 用途 | DNS 归属 | 数据面 |
|------|------|----------|--------|
| `main` | 主线机型（IPQ、MTK 等） | honk 自己接管 :53，走内置 DoH 上游 | honk 的 TCX + 原版 fw4/NSS |
| `mydist` | **仅 X86 / ROCKCHIP**（mydist 固件） | SmartDNS 独占 :53，honk 不碰 DNS | honk TCX + einat/dpd/ACL（classic TC） |

### 为什么需要第二种对接方式

honk 默认的 DNS 设计是“自己接管”：

- `system.dae` 里 `nfqueue_enable: true`，控制脚本会把 `nfqueue_enable` 强制写回 true；
- `config.dae` 的 `routing` 里有两条 `!dport(53) -> direct(must)`，把 :53 从内核直连路径里**排除**；
- 于是它的数据面会把 LAN 的 :53 重定向进自己的 DNS 引擎，用自己的 `dns.upstream` 解析。

mydist 固件里 DNS 有唯一归属：**SmartDNS 监听 :53**（`dnsmasq` 端口 0、停用）。如果 honk 继续按默认策略接管 :53：

1. SmartDNS 永远收不到 LAN 的查询；
2. honk 自己的 DoH 上游（`https://223.5.5.5/dns-query`）在部分网络不可用；
3. DNS 的日志、缓存、DoT 上游全部脱离这套固件的控制面。

### `mydist` 分支改了什么

只改 `honk/files/config.dae` 三处：

| # | 主线 | `mydist` | 作用 |
|---|------|----------|------|
| 1 | 无 `dport(53)` 规则，只有 `dip(...) && !dport(53)` | `dport(53) -> direct(must)` 作为**第一条**路由规则 | :53 留在内核直连路径，查询交给 SmartDNS |
| 2 | 两条 `direct(must)` 带 `&& !dport(53)` | 去掉这个条件 | 不再出现“自相矛盾”的规则 |
| 3 | `default: 'https://223.5.5.5/dns-query...'` | `default: 'udp://127.0.0.1:53'` | honk 自身（节点解析、规则匹配）也走 SmartDNS |

`dns.routing` 的 `request` 段（private/cn/fallback）不变，节点、订阅、Doona、LuCI 全部不变。

### 与 `mydist/router-dns` 的配合

`/etc/honk/config.dae` 是 conffile，升级不会覆盖用户文件。所以固件里的 `mydist/router-dns` 每次启动（`START=18`，早于 honk 的 `S95`）都会调用 `honk-dns.sh patch`：

- 幂等删除自己上次写入的标记行，再重新插入 `dport(53) -> direct(must)`；
- 去掉残留的 `&& !dport(53)`；
- 只在 `default` 仍是 stock DoH 时才把它改成 `udp://127.0.0.1:53`（用户自己改过就不动）；
- 如果 UI 把 `config.dae` 重写坏了，用 `config.dae.mydist.bak` 恢复后再打一次。

这样老机器升级、UI 重置、honk 重装都不会把 DNS 归属弄丢。

### 数据面为什么能共存

honk 用 **TCX** 挂程序，einat 也用 TCX；而 mydist 的 ACL/快路径用 **classic `cls_bpf`**。内核先执行 TCX、再执行 classic，所以：

```
WAN ingress : honk TCX → einat TCX → router-acl (pref 90) → dpd (pref 100)
```

honk 决定代理的流在 TCX 阶段就被重定向到 `dae0`，根本到不了后面两层；只有 honk 放行的直连流才会被 einat/dpd 接手。这是两种“加速”能同时存在的原因，也是 `mydist` 分支不需要改数据面的原因。

### 构建与发布（`generated-*` 资产）

本仓库的 `.gitignore` 排除了三个构建产物，它们由 `release.yml` 作为 **release asset** 发布：

| 文件 | 内容 |
|------|------|
| `honk/generated-stage.mk` | 每个架构的 `honk-core` 资产名 + SHA256 + `PKG_SOURCE_URL` |
| `honk/generated-provenance.json` | 核心/Doona 提交、补丁摘要、工具版本，打包进 `/usr/share/honk/provenance.json` |
| `luci-app-honk/generated-doona-stage.mk` | Doona 归档的 URL + SHA256 |

消费方（CI 的 `Scripts/Packages.sh`）按 `honk/Makefile` 的 `CORE_COMMIT` 找到对应 release，下载三个文件，并把里面写死的 `kenzok8/openwrt-honk` URL 改写成实际 release 目录。

`ci/pins.env` 固定了核心提交 `423fef2…`、Doona 提交、Zig 0.14.1、bpf-linker 0.11.0 与 OpenWrt SDK 版本；改版本必须同时更新 pin 与 `generated-stage.mk`。

### 使用方式

| 使用方 | 分支 |
|--------|------|
| `kwrum1/honk-ImmortalWRT-CI` 的 X86 / ROCKCHIP | `mydist` |
| 其它所有目标、手动安装脚本 | `main` |

安装脚本与主线行为一致；`mydist` 分支只是把 DNS 交还给 SmartDNS，不改变 honk 的核心二进制、Doona 界面或节点配置格式。

