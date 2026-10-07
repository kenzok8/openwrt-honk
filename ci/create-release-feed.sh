#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/ci/pins.env"
APK_DIR=${HONK_APK_DIR:-"$ROOT/artifacts/apk"}
FEED_DIR=${HONK_FEED_DIR:?Set HONK_FEED_DIR to a new output directory}
APK_TOOL=${HONK_APK_TOOL:?Set HONK_APK_TOOL to the pinned apk-tools 3 binary}
APK_SIGN_KEY=${HONK_APK_SIGN_KEY:?Set HONK_APK_SIGN_KEY to the external APK signing key}
APK_KEYS_DIR=${HONK_APK_KEYS_DIR:?Set HONK_APK_KEYS_DIR to trusted APK public keys}
MANIFEST_SIGN_KEY=${HONK_MANIFEST_SIGN_KEY:?Set HONK_MANIFEST_SIGN_KEY to the external usign key}
MANIFEST_PUBLIC_KEY=${HONK_MANIFEST_PUBLIC_KEY:?Set HONK_MANIFEST_PUBLIC_KEY to its matching public key}
USIGN=${HONK_USIGN:?Set HONK_USIGN to the pinned OpenWrt usign binary}
BASE_URL=${HONK_FEED_BASE_URL:?Set HONK_FEED_BASE_URL to the HTTPS feed directory}

for tool in "$APK_TOOL" "$USIGN" node sha256sum stat cp tar; do
	command -v "$tool" >/dev/null 2>&1 || test -x "$tool" || { echo "Missing required tool: $tool" >&2; exit 1; }
done
test -f "$APK_SIGN_KEY" && test ! -L "$APK_SIGN_KEY" || { echo 'APK signing key is not a regular file.' >&2; exit 1; }
test -f "$MANIFEST_SIGN_KEY" && test ! -L "$MANIFEST_SIGN_KEY" || { echo 'Manifest signing key is not a regular file.' >&2; exit 1; }
test -f "$MANIFEST_PUBLIC_KEY" && test ! -L "$MANIFEST_PUBLIC_KEY" || { echo 'Manifest public key is not a regular file.' >&2; exit 1; }
test -d "$APK_KEYS_DIR" && test ! -L "$APK_KEYS_DIR" || { echo 'APK trust-key directory is unavailable.' >&2; exit 1; }
case "$BASE_URL" in https://*) ;; *) echo 'The release feed URL must use HTTPS.' >&2; exit 1 ;; esac
case "$BASE_URL" in *\?*|*\#*|*\@*) echo 'The release feed URL may not contain credentials, query, or fragment data.' >&2; exit 1 ;; esac
[[ "$BASE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/%+-]*)?$ ]] || { echo 'The release feed URL contains unsupported characters.' >&2; exit 1; }
test -s "$ROOT/artifacts/cache/$CORE_ARCHIVE" || { echo 'The pinned core archive is missing.' >&2; exit 1; }
test -s "$ROOT/artifacts/cache/$DOONA_ARCHIVE" || { echo 'The pinned Doona archive is missing.' >&2; exit 1; }
test -s "$ROOT/honk/generated-provenance.json" || { echo 'The generated core provenance is missing.' >&2; exit 1; }
test -s "$ROOT/honk/generated-stage.mk" || { echo 'The generated core stage is missing.' >&2; exit 1; }
test -s "$ROOT/luci-app-honk/generated-doona-stage.mk" || { echo 'The generated Doona stage is missing.' >&2; exit 1; }
test "$(sha256sum "$ROOT/ci/patches/honk-openwrt.patch" | cut -d' ' -f1)" = "$CORE_PATCH_SHA256" || { echo 'The core patch does not match its pinned checksum.' >&2; exit 1; }
test "$(sha256sum "$ROOT/ci/patches/doona-openwrt.patch" | cut -d' ' -f1)" = "$DOONA_PATCH_SHA256" || { echo 'The Doona patch does not match its pinned checksum.' >&2; exit 1; }
test ! -e "$FEED_DIR" && test ! -L "$FEED_DIR" || { echo 'The output directory must not already exist.' >&2; exit 1; }

mkdir -p "$(dirname "$FEED_DIR")"
STAGE=$(mktemp -d "$(dirname "$FEED_DIR")/.honk-feed.XXXXXX")
cleanup() {
	rm -rf "$STAGE"
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$STAGE/packages"
chmod 0755 "$STAGE/packages"

packages=()
for name in honk luci-app-honk; do
	mapfile -t matches < <(find "$APK_DIR" -maxdepth 1 -type f -name "$name-*.apk" -print | sort)
	[ "${#matches[@]}" -eq 1 ] || { echo "Expected exactly one $name APK; found ${#matches[@]}." >&2; exit 1; }
	package=${matches[0]}
	"$APK_TOOL" --keys-dir "$APK_KEYS_DIR" verify "$package" >/dev/null
	cp -p "$package" "$STAGE/packages/$(basename "$package")"
	chmod 0644 "$STAGE/packages/$(basename "$package")"
	packages+=("$STAGE/packages/$(basename "$package")")
done

node - "$ROOT" "$STAGE" "$BASE_URL" "$APK_TOOL" "${packages[@]}" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const [root, stage, baseUrl, apkTool, ...files] = process.argv.slice(2);
const pins = Object.fromEntries(fs.readFileSync(path.join(root, 'ci/pins.env'), 'utf8')
	.split(/\r?\n/).filter(line => /^[A-Z0-9_]+=/.test(line))
	.map(line => line.split(/=(.*)/s).slice(0, 2)));
const required = ['CORE_COMMIT', 'CORE_PATCH_SHA256', 'DOONA_COMMIT', 'DOONA_PATCH_SHA256', 'OPENWRT_SDK_SHA256'];
for (const key of required) {
	if (!pins[key]) throw new Error(`Missing pinned value: ${key}`);
}
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const sha256 = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const makeValue = (filename, key) => {
	const source = fs.readFileSync(filename, 'utf8');
	const match = source.match(new RegExp(`^${key}:?=([^\\r\\n]+)$`, 'm'));
	if (!match) throw new Error(`Missing ${key} in ${path.relative(root, filename)}`);
	return match[1].trim();
};
const generated = readJson(path.join(root, 'honk/generated-provenance.json'));
const coreArchive = path.join(root, 'artifacts/cache', pins.CORE_ARCHIVE);
const doonaArchive = path.join(root, 'artifacts/cache', pins.DOONA_ARCHIVE);
if (generated.core?.commit !== pins.CORE_COMMIT || generated.core?.patch_sha256 !== pins.CORE_PATCH_SHA256)
	throw new Error('Generated core provenance does not match the pinned source and patch.');
if (generated.doona?.source_commit !== pins.DOONA_COMMIT || generated.doona?.version !== pins.DOONA_VERSION ||
	generated.doona?.patch_sha256 !== pins.DOONA_PATCH_SHA256)
	throw new Error('Generated Doona provenance does not match the pinned source and patch.');
if (generated.core_archive?.filename !== pins.CORE_ARCHIVE || generated.core_archive?.sha256 !== sha256(coreArchive))
	throw new Error('Generated core archive provenance does not match the staged archive.');
if (generated.doona?.artifact_sha256 !== sha256(doonaArchive))
	throw new Error('Generated Doona provenance does not match the staged archive.');
if (makeValue(path.join(root, 'honk/generated-stage.mk'), 'PKG_HASH') !== sha256(coreArchive) ||
	makeValue(path.join(root, 'luci-app-honk/generated-doona-stage.mk'), 'PKG_HASH') !== sha256(doonaArchive))
	throw new Error('A generated package stage does not match its archived input.');
const sourceResult = spawnSync('tar', ['-xOzf', doonaArchive, 'doona/SOURCE'], { encoding: 'utf8' });
if (sourceResult.status !== 0 ||
	!sourceResult.stdout.includes(`Repository: ${pins.DOONA_REPOSITORY}`) ||
	!sourceResult.stdout.includes(`Commit: ${pins.DOONA_COMMIT}`) ||
	!sourceResult.stdout.includes(`Version: ${pins.DOONA_VERSION}`) ||
	!sourceResult.stdout.includes(`Build patch SHA256: ${pins.DOONA_PATCH_SHA256}`))
	throw new Error('The Doona archive SOURCE record does not match the pinned build.');
const expectedVersions = {
	honk: `${makeValue(path.join(root, 'honk/Makefile'), 'PKG_VERSION')}-r${makeValue(path.join(root, 'honk/Makefile'), 'PKG_RELEASE')}`,
	'luci-app-honk': `${makeValue(path.join(root, 'luci-app-honk/Makefile'), 'PKG_VERSION')}-r${makeValue(path.join(root, 'luci-app-honk/Makefile'), 'PKG_RELEASE')}`
};
const expectedNames = new Set(['honk', 'luci-app-honk']);
const packages = files.map(file => {
	const dump = spawnSync(apkTool, ['adbdump', '--format', 'json', file], { encoding: 'utf8' });
	if (dump.status !== 0) throw new Error(`Could not read APK metadata: ${path.basename(file)}`);
	const info = JSON.parse(dump.stdout).info;
	if (!info || !expectedNames.delete(info.name)) throw new Error(`Unexpected or duplicate APK name: ${info && info.name}`);
	if (typeof info.version !== 'string' || info.version !== expectedVersions[info.name])
		throw new Error(`Unexpected ${info.name} version; expected ${expectedVersions[info.name]}.`);
	if ((info.name === 'honk' && info.arch !== 'x86_64') ||
		(info.name !== 'honk' && !['x86_64', 'noarch'].includes(info.arch)))
		throw new Error(`Unsupported ${info.name} architecture: ${info.arch}`);
	const filename = path.basename(file);
	if (filename !== `${info.name}-${info.version}.apk`)
		throw new Error(`APK filename does not match metadata: ${filename}`);
	const bytes = fs.readFileSync(file);
	return {
		name: info.name,
		version: info.version,
		arch: info.arch,
		file,
		filename,
		size: bytes.length,
		sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
		url: `${baseUrl.replace(/\/$/, '')}/packages/${filename}`
	};
});
if (expectedNames.size !== 0) throw new Error(`Missing packages: ${[...expectedNames].join(', ')}`);
packages.sort((a, b) => a.name.localeCompare(b.name));
const verifyDir = fs.mkdtempSync(path.join(stage, '.verify-'));
const run = (command, args) => {
	const result = spawnSync(command, args, { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`${path.basename(command)} failed while validating staged package contents.`);
	return result.stdout;
};
const safeTarExtract = (archive, destination) => {
	const members = run('tar', ['-tzf', archive]).split(/\r?\n/).filter(Boolean);
	for (const member of members) {
		if (member.startsWith('/') || member.split('/').includes('..'))
			throw new Error(`Unsafe path in generated archive: ${member}`);
	}
	run('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', destination]);
};
const extractApk = (entry, destination) => {
	fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
	run(apkTool, ['extract', '--destination', destination, '--no-chown', entry]);
};
const treeDigest = rootPath => {
	const entries = [];
	const visit = (directory, prefix) => {
		for (const name of fs.readdirSync(directory).sort()) {
			const absolute = path.join(directory, name);
			const relative = prefix ? `${prefix}/${name}` : name;
			const stat = fs.lstatSync(absolute);
			if (stat.isSymbolicLink()) entries.push(`link\0${relative}\0${fs.readlinkSync(absolute)}`);
			else if (stat.isDirectory()) visit(absolute, relative);
			else if (stat.isFile()) entries.push(`file\0${relative}\0${sha256(absolute)}`);
			else throw new Error(`Unsupported staged file type: ${relative}`);
		}
	};
	visit(rootPath, '');
	return crypto.createHash('sha256').update(entries.join('\n')).digest('hex');
};
const coreStage = path.join(verifyDir, 'core');
const doonaStage = path.join(verifyDir, 'doona');
const honkRoot = path.join(verifyDir, 'honk-apk');
const luciRoot = path.join(verifyDir, 'luci-apk');
fs.mkdirSync(coreStage, { mode: 0o700 });
fs.mkdirSync(doonaStage, { mode: 0o700 });
safeTarExtract(coreArchive, coreStage);
safeTarExtract(doonaArchive, doonaStage);
const byName = Object.fromEntries(packages.map(entry => [entry.name, entry]));
extractApk(byName.honk.file, honkRoot);
extractApk(byName['luci-app-honk'].file, luciRoot);
const coreRoot = path.join(coreStage, `honk-core-${pins.CORE_COMMIT}`);
const embeddedProvenance = readJson(path.join(honkRoot, 'usr/share/honk/provenance.json'));
if (JSON.stringify(embeddedProvenance) !== JSON.stringify(generated))
	throw new Error('The Honk APK provenance differs from the generated core provenance.');
if (sha256(path.join(honkRoot, 'usr/bin/honk-core')) !== sha256(path.join(coreRoot, 'honk-core')))
	throw new Error('The Honk APK core binary does not match the generated core archive.');
const expectedDoonaRoot = path.join(doonaStage, 'doona');
const coreDoonaRoot = path.join(coreRoot, 'doona');
const luciDoonaRoot = path.join(luciRoot, 'usr/share/doona');
const expectedDoonaDigest = treeDigest(expectedDoonaRoot);
if (treeDigest(coreDoonaRoot) !== expectedDoonaDigest || treeDigest(luciDoonaRoot) !== expectedDoonaDigest)
	throw new Error('The Doona assets in the APK tuple do not match the generated Doona archive.');
fs.rmSync(verifyDir, { recursive: true, force: true });
const manifest = {
	schema: 1,
	product: 'openwrt-honk',
	target: {
		architecture: 'x86_64',
		openwrt: '25.12',
		package_format: 'apk',
		kernel_min: '6.12',
		requires_btf: true
	},
	min_updater_api: 1,
	state_schema: 2,
	core: {
		commit: pins.CORE_COMMIT,
		patch_sha256: pins.CORE_PATCH_SHA256,
		artifact_sha256: sha256(coreArchive)
	},
	doona: {
		commit: pins.DOONA_COMMIT,
		patch_sha256: pins.DOONA_PATCH_SHA256,
		artifact_sha256: sha256(doonaArchive)
	},
	sdk_sha256: pins.OPENWRT_SDK_SHA256,
	packages: packages.map(({ file, ...entry }) => entry)
};
const target = path.join(stage, 'manifest.json');
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
NODE

"$USIGN" -S -m "$STAGE/manifest.json" -s "$MANIFEST_SIGN_KEY" -x "$STAGE/manifest.json.sig"
"$USIGN" -V -m "$STAGE/manifest.json" -p "$MANIFEST_PUBLIC_KEY" -x "$STAGE/manifest.json.sig"
"$APK_TOOL" --keys-dir "$APK_KEYS_DIR" mkndx --output "$STAGE/packages/Packages.adb" --sign-key "$APK_SIGN_KEY" "$STAGE/packages"/*.apk
"$APK_TOOL" --keys-dir "$APK_KEYS_DIR" verify "$STAGE/packages/Packages.adb" "$STAGE/packages"/*.apk
chmod 0644 "$STAGE/manifest.json" "$STAGE/manifest.json.sig" "$STAGE/packages/Packages.adb"
chmod 0755 "$STAGE"
mv "$STAGE" "$FEED_DIR"
trap - EXIT HUP INT TERM
printf 'Signed release feed is ready at %s\n' "$FEED_DIR"
