# SPDX-License-Identifier: GPL-3.0-only
#
# Copyright (C) 2026 kenzok8

include $(TOPDIR)/rules.mk

PKG_NAME:=honk
PKG_VERSION:=2026.10.05
PKG_RELEASE:=2

include $(CURDIR)/generated-stage.mk

CORE_PATCH_SHA256:=$(shell sed -n 's/^CORE_PATCH_SHA256=//p' $(CURDIR)/../ci/pins.env)

ifeq ($(HONK_SDK_PACKAGE),1)
ifeq ($(wildcard $(CURDIR)/generated-stage.mk),)
$(error HONK_SDK_PACKAGE requires the verified generated core stage)
endif
ifeq ($(wildcard $(CURDIR)/generated-provenance.json),)
$(error HONK_SDK_PACKAGE requires generated core provenance)
endif
HONK_BTF_BUILD_DEPENDS:=
else
HONK_BTF_BUILD_DEPENDS:=+@KERNEL_DEBUG_INFO_BTF
endif

PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=kenzok8

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/honk
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=Honk transparent proxy core
  URL:=https://github.com/Glassyiris/honk
	DEPENDS:=@TARGET_x86_64 +ca-bundle +ip-full +ubus +kmod-sched-core +kmod-sched-bpf +kmod-veth +kmod-nft-queue +curl +jsonfilter +jshn +sqlite3-cli +libubox +usign +coreutils-stat $(HONK_BTF_BUILD_DEPENDS)
endef

define Package/honk/description
  Honk is a transparent proxy core for OpenWrt x86_64.
endef

define Package/honk/conffiles
/etc/config/honk
/etc/honk/config.dae
/etc/honk/system.dae
endef

define Build/Prepare
	test -s $(CURDIR)/generated-provenance.json
	test "$(HONK_CORE_PATCH_SHA256)" = "$(CORE_PATCH_SHA256)"
	grep -Fq '"patch_sha256": "$(CORE_PATCH_SHA256)"' $(CURDIR)/generated-provenance.json
	grep -Fq '"filename": "$(PKG_SOURCE)"' $(CURDIR)/generated-provenance.json
	grep -Fq '"sha256": "$(PKG_HASH)"' $(CURDIR)/generated-provenance.json
	mkdir -p $(PKG_BUILD_DIR)
	$(TAR) --strip-components=1 -C $(PKG_BUILD_DIR) -xzf $(DL_DIR)/$(PKG_SOURCE)
endef

define Build/Compile
endef

define Package/honk/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/honk-core $(1)/usr/bin/honk-core

	$(INSTALL_DIR) $(1)/usr/share/licenses/honk
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/LICENSE $(1)/usr/share/licenses/honk/LICENSE
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/doona/LICENSE $(1)/usr/share/licenses/honk/DOONA-LICENSE
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/doona/NOTICE $(1)/usr/share/licenses/honk/DOONA-NOTICE
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/doona/THIRD-PARTY-NOTICES.txt $(1)/usr/share/licenses/honk/DOONA-THIRD-PARTY-NOTICES.txt
	$(INSTALL_DIR) $(1)/usr/share/licenses/honk/DOONA-LICENSES
	$(CP) $(PKG_BUILD_DIR)/doona/LICENSES/* $(1)/usr/share/licenses/honk/DOONA-LICENSES/

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
	$(INSTALL_DATA) $(CURDIR)/generated-provenance.json $(1)/usr/share/honk/provenance.json
endef

$(eval $(call BuildPackage,honk))
