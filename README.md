# Honk for OpenWrt

Honk 是 OpenWrt x86_64 的透明代理核心，提供 LuCI 管理页，并用 Doona 提供核心 Web 界面。仓库包含 `honk` 与 `luci-app-honk` 两个软件包；LuCI 中文翻译直接编译进 `luci-app-honk`，不再单独提供 `luci-i18n-honk-zh-cn`。Doona 随 LuCI 包安装到 `/usr/share/doona`，供核心 Web 界面使用，不另起服务。

## 使用

安装 `honk` 和 `luci-app-honk` 后，在 LuCI「服务 → Honk」中初始化服务，运行系统检查并启动。`honk` 依赖 `v2ray-geoip` 与 `v2ray-geosite` 提供路由 GeoIP/GeoSite 数据（来自 `kenzok8/wall` 源），可在「维护」页手动更新或配置每日/每周自动更新。核心 Web 界面仅在已初始化、正在运行且 API 就绪时开放。

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

## 许可

本仓库原创集成文件采用 GPL-3.0-only。Honk 核心与 Doona 各自保留上游许可和第三方声明；打包时随软件安装至 `/usr/share/licenses/`。核心提交、Doona 提交、补丁摘要及实际阶段归档散列记录在构建生成的 provenance 文件中。
