# SPDX-License-Identifier: GPL-3.0-only
#
# Copyright (C) 2026 kenzok8

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Honk
LUCI_DEPENDS:=+honk +rpcd +luci-base +cgi-io +curl +jsonfilter +libubox
LUCI_PKGARCH:=all
LUCI_URL:=https://github.com/kenzok8/openwrt-honk
LUCI_MAINTAINER:=kenzok8

PKG_NAME:=luci-app-honk
PKG_VERSION:=2026.10.05
PKG_RELEASE:=3

PKG_SOURCE:=doona-f8fd5228.tar.gz
PKG_SOURCE_URL:=https://github.com/kenzok8/openwrt-honk/releases/download/staging
PKG_SOURCE_SUBDIR:=doona
PKG_HASH:=d5725cad5b30df11c5886480dfcd3860e9ab61935583ef3a8465c15b4df97481

-include $(CURDIR)/generated-doona-stage.mk

define Build/Prepare/luci-app-honk
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/share/doona
	$(TAR) --strip-components=1 -C $(PKG_BUILD_DIR)/root/usr/share/doona -xzf $(DL_DIR)/$(PKG_SOURCE)
	$(SED) 's#^Build patch: .*#Build patch: ci/patches/doona-openwrt.patch#' $(PKG_BUILD_DIR)/root/usr/share/doona/SOURCE
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/share/licenses/honk-doona
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/root/usr/share/doona/LICENSE $(PKG_BUILD_DIR)/root/usr/share/licenses/honk-doona/LICENSE
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/root/usr/share/doona/NOTICE $(PKG_BUILD_DIR)/root/usr/share/licenses/honk-doona/NOTICE
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/root/usr/share/doona/THIRD-PARTY-NOTICES.txt $(PKG_BUILD_DIR)/root/usr/share/licenses/honk-doona/THIRD-PARTY-NOTICES.txt
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/share/licenses/honk-doona/LICENSES
	$(CP) $(PKG_BUILD_DIR)/root/usr/share/doona/LICENSES/* $(PKG_BUILD_DIR)/root/usr/share/licenses/honk-doona/LICENSES/
endef

include $(TOPDIR)/feeds/luci/luci.mk
# call BuildPackage - OpenWrt buildroot signature
