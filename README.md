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
- Geo 数据由 `v2ray-geoip` / `v2ray-geosite`（`kenzok8/wall` 源）提供，可在维护页手动更新或定时更新

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

> `v2ray-geoip` / `v2ray-geosite` 由 [kenzok8/wall](https://github.com/kenzok8/wall) 源提供，请确保已添加该源（脚本会检测并提示）。

## 使用

安装 `honk` 和 `luci-app-honk` 后，在 LuCI「服务 → Honk」中初始化服务，运行系统检查并启动。核心 Web 界面（Doona）仅在已初始化、正在运行且 API 就绪时开放。

节点与订阅直接写入 `/etc/honk/config.dae`（`node { label: 'share-link' }` 或 `subscription { tag: 'url' }`），重载 Honk 后生效；路由、DNS 与订阅也可在 Doona 面板中管理。

管理入口和 API 只应在可信 LAN 内使用。若 LuCI 通过未加密的 HTTP 提供，浏览器到路由器间的登录信息和 API 流量没有传输加密保护；请勿将管理页面暴露到互联网。

## 固定源码与构建

核心来自 `https://github.com/Glassyiris/honk` 的完整提交 `5ad13acaaf6e5719d7a2f169225201aae716c416`，Doona 来自 `https://github.com/Zakkaus/doona` 的完整提交 `f8fd5228b3bb49b89d2fcd85b99a8adad69994cf`。Doona 的 OpenWrt 补丁摘要和 OpenWrt 25.12.4 x86/64 官方 SDK 地址、SHA256 均固定在 `ci/pins.env`。构建脚本从这些固定输入生成静态 UI、stock musl 核心和 APK；不会自动发布。

完整构建（包括核心构建）需在大小写敏感的 Linux 文件系统上运行（Doona 上游同时有仅大小写不同的文件）。需要 Rust/rustup、Zig 0.14.1、Node.js 22.13 或更新版本与 Corepack、Git、curl、ripgrep、GNU tar、zstd、`readelf`，以及 `build-essential`、clang、LLVM、libbpf、libelf、pkg-config、CMake、libclang 和 OpenWrt SDK 所需工具。核心交叉编译脚本会核对 Rust/Doona/SDK 输入和 Zig、bpf-linker 版本；SDK 阶段限定 Linux x86_64。

在满足工具要求的 Linux 环境中按顺序运行：

```sh
bash scripts/check.sh
ci/build-doona.sh
ci/build-core.sh
ci/build-sdk.sh
```

脚本将归档写入被 Git 忽略的 `artifacts/cache/`，APK 写入 `artifacts/apk/`。本地没有生成的阶段归档时，`honk/Makefile` 保留一个 debug 预构建核心作为原型输入；其下载地址可能指向滚动的 debug 资产，但 SHA256 仍必须精确匹配 Makefile 中固定值。正式阶段构建会生成带实际 SHA256 的忽略文件并覆盖该默认值，SDK 构建也会预先把同名归档放进下载缓存；任何散列不匹配都会使构建失败，不跳过校验。

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
