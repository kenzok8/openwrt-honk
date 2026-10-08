# SPDX-License-Identifier: GPL-3.0-only
#
# Copyright (C) 2026 kenzok8

include $(TOPDIR)/rules.mk

PKG_NAME:=honk
PKG_VERSION:=2026.10.07
PKG_RELEASE:=1

# Raw upstream release tag; the asset name keeps this exact spelling.
HONK_RELEASE_TAG:=debug.2026.10.7.native-api.1
HONK_ASSET_TAG:=debug

# SHA256 of each prebuilt release tarball, kept in sync by scripts/update-honk-version.sh.
HONK_HASH_X86_64:=41114fc58c069c5dc2550dc6563755a2bc4b1f9a52eec128300bb4c3ad23fd80
HONK_HASH_AARCH64:=2aada1c945ace03c6403cc587940b4eddf31cb0846ec31e8318efbd5317b36b7

PKG_LICENSE:=AGPL-3.0-only
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=kenzok8

ifeq ($(ARCH),x86_64)
  HONK_TARGET:=x86_64-unknown-linux-musl
  HONK_HASH:=$(HONK_HASH_X86_64)
else ifeq ($(ARCH),aarch64)
  HONK_TARGET:=aarch64-unknown-linux-musl
  HONK_HASH:=$(HONK_HASH_AARCH64)
endif

HONK_SUFFIX:=-stock
HONK_ASSET:=honk-core-$(HONK_ASSET_TAG)-$(HONK_TARGET)$(HONK_SUFFIX).tar.gz

PKG_SOURCE:=$(HONK_ASSET)
PKG_SOURCE_URL:=https://github.com/Glassyiris/honk/releases/download/$(HONK_RELEASE_TAG)/
PKG_HASH:=$(HONK_HASH)

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/honk
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=Honk transparent proxy core
  URL:=https://github.com/Glassyiris/honk
  DEPENDS:=@(x86_64||aarch64) +ca-bundle +ip-full +ubus +kmod-sched-core +kmod-sched-bpf +kmod-veth +kmod-nft-queue +curl +jsonfilter +jshn +sqlite3-cli +libubox +usign +coreutils-stat +v2ray-geoip +v2ray-geosite +@KERNEL_DEBUG_INFO_BTF
endef

define Package/honk/description
  Honk is a transparent proxy core for OpenWrt x86_64 and aarch64.
endef

define Package/honk/conffiles
/etc/config/honk
/etc/honk/config.dae
/etc/honk/system.dae
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(TAR) -xzf $(DL_DIR)/$(PKG_SOURCE) -C $(PKG_BUILD_DIR) --strip-components=1
endef

define Build/Compile
endef

define Package/honk/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/honk-core $(1)/usr/bin/honk-core

	$(INSTALL_DIR) $(1)/usr/share/licenses/honk
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/LICENSE $(1)/usr/share/licenses/honk/LICENSE

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(CURDIR)/files/honk.config $(1)/etc/config/honk

	$(INSTALL_DIR) $(1)/etc/honk
	$(INSTALL_CONF) $(CURDIR)/files/config.dae $(1)/etc/honk/config.dae
	$(INSTALL_CONF) $(CURDIR)/files/system.dae $(1)/etc/honk/system.dae
	chmod 0444 $(1)/etc/honk/system.dae
	$(INSTALL_DIR) $(1)/etc/honk/state
	chmod 0700 $(1)/etc/honk/state

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/files/honk.init $(1)/etc/init.d/honk
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) $(CURDIR)/files/90-honk-boot $(1)/etc/uci-defaults/90-honk

	$(INSTALL_DIR) $(1)/usr/share/honk
	$(INSTALL_DATA) $(CURDIR)/files/default-config.dae $(1)/usr/share/honk/default-config.dae
	$(INSTALL_BIN) $(CURDIR)/files/control.sh $(1)/usr/share/honk/control.sh
	$(INSTALL_BIN) $(CURDIR)/files/lock.sh $(1)/usr/share/honk/lock.sh
	$(INSTALL_BIN) $(CURDIR)/files/lifecycle.sh $(1)/usr/share/honk/lifecycle.sh
	$(INSTALL_BIN) $(CURDIR)/files/maintenance.sh $(1)/usr/share/honk/maintenance.sh
	$(INSTALL_BIN) $(CURDIR)/files/job.sh $(1)/usr/share/honk/job.sh
	$(INSTALL_BIN) $(CURDIR)/files/update.sh $(1)/usr/share/honk/update.sh
	$(INSTALL_BIN) $(CURDIR)/files/redact-log.sh $(1)/usr/share/honk/redact-log.sh
	$(INSTALL_BIN) $(CURDIR)/files/log-level-filter.sh $(1)/usr/share/honk/log-level-filter.sh
	$(INSTALL_DATA) $(CURDIR)/files/log-lines.sh $(1)/usr/share/honk/log-lines.sh
endef

$(eval $(call BuildPackage,honk))
