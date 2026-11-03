#!/usr/bin/env python3
"""Run package shell scripts against isolated command and filesystem fixtures."""
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def shell_function(source, name):
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}", source, re.M | re.S)
    if not match:
        raise ValueError(f"missing shell function: {name}")
    return match.group()


class BtfTest(unittest.TestCase):
    def test_kernel_preflight_accepts_builtin_or_external_btf(self):
        source = (ROOT / "honk/files/control.sh").read_text()
        check = shell_function(source, "check_kernel")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builtin, external = root / "builtin", root / "external"
            check = check.replace("/sys/kernel/btf/vmlinux", str(builtin)).replace("/usr/lib/debug/boot/vmlinux", str(external))
            mocks = '''fail() { echo "$*" >&2; }
uname() { echo 6.12.112; }
grep() { return 0; }
module_available() { return 0; }
ip() { :; }
modprobe() { :; }
'''
            # bpffs existence is separate from the BTF source selection.
            check = check.replace("[ -d /sys/fs/bpf ]", "true")
            for kind in ("builtin", "external", "neither"):
                for path in (builtin, external):
                    path.unlink(missing_ok=True)
                if kind != "neither":
                    (root / kind).write_text("BTF fixture")
                with self.subTest(kind=kind):
                    result = subprocess.run(["sh", "-c", mocks + check + "\ncheck_kernel"], capture_output=True)
                    self.assertEqual(result.returncode, int(kind == "neither"), result.stderr)


class PackageUpgradeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for name in ("bin", "tmp", "usr/share/honk", "etc/init.d"):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        self.env = os.environ | {"FIXTURE": str(self.root), "PATH": f"{self.root / 'bin'}:{os.environ['PATH']}"}
        self.write("state", "1")
        self.write("installed", "2026.11.02-r1")
        self.write("events", "")
        self.write("bin/flock", f'''#!{sys.executable}
import fcntl, sys
try:
    fcntl.flock(int(sys.argv[-1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(1)
''')
        self.write("bin/apk", f'''#!{sys.executable}
import os, pathlib, sys, time
r = pathlib.Path(os.environ['FIXTURE'])
a = sys.argv[1:]
assert a[:1] == ['--cache-dir'], a
a = a[2:]
offline = '--no-network' in a
a = [x for x in a if x != '--no-network']
if a == ['update']: action = 'update'
elif a[:2] == ['list', '--available']: action = 'available'
elif a[:2] == ['list', '--installed']: action = 'installed'
elif a[:2] == ['cache', 'download']: action = 'download'
elif a[:2] == ['add', '--simulate']: action = 'offline-preflight' if offline else 'preflight'
elif a[:1] == ['add']:
    action = 'install'
    assert offline, 'installation must not need the proxy network'
    assert (r / 'state').read_text() == '0', 'live core replaced before stop'
else: raise AssertionError(a)
with (r / 'events').open('a') as f: f.write(action + '\\n')
if action == 'download' and os.environ.get('WAIT_DOWNLOAD'):
    deadline = time.monotonic() + 5
    while not (r / 'continue').exists():
        if time.monotonic() > deadline: sys.exit(32)
        time.sleep(.01)
if os.environ.get('FAIL_AT') == action: sys.exit(31)
if action == 'available': print(a[-1] + '-2026.11.03-r2 x86_64')
if action == 'installed': print(a[-1] + '-' + (r / 'installed').read_text() + ' x86_64')
if action == 'install':
    if not os.environ.get('WRONG_VERSION'): (r / 'installed').write_text('2026.11.03-r2')
    if os.environ.get('POSTINSTALL_START', '1') == '1': (r / 'state').write_text('1')
''')
        self.write("usr/share/honk/lifecycle.sh", '''honk_lifecycle_managed_pid() { [ "$(cat "$FIXTURE/state")" = 1 ] && echo 42; }
honk_lifecycle_stop() {
    echo stop >> "$FIXTURE/events"
    [ "${FAIL_AT:-}" != stop ] || return 31
    printf 0 > "$FIXTURE/state"
}
honk_lifecycle_start() {
    echo start >> "$FIXTURE/events"
    [ "${FAIL_AT:-}" != start ] || return 31
    printf 1 > "$FIXTURE/state"
}
honk_lifecycle_wait_ready() {
    echo ready >> "$FIXTURE/events"
    [ "${FAIL_AT:-}" != ready ]
}
''')
        self.write("etc/init.d/rpcd", '#!/bin/sh\necho rpcd >> "$FIXTURE/events"\n')
        source = (ROOT / "luci-app-honk/root/usr/share/luci-app-honk/update-pkg.sh").read_text()
        for path in ("/tmp/", "/usr/share/honk/", "/etc/init.d/"):
            source = source.replace(path, str(self.root) + path)
        self.write("update.sh", source)

    def write(self, name, text):
        path = self.root / name
        path.write_text(text)
        path.chmod(0o755)

    def launch(self, pkg="honk", **env):
        return subprocess.run(["sh", str(self.root / "update.sh"), pkg], env=self.env | env, capture_output=True, text=True, timeout=5)

    def result(self):
        log = self.root / "tmp/luci-app-honk.pkg-honk.log"
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            text = log.read_text() if log.exists() else ""
            if ("✓" in text or "✗" in text) and not list((self.root / "tmp").glob(".honk-upd-*")):
                return text, (self.root / "events").read_text().splitlines()
            time.sleep(.02)
        self.fail("background upgrade did not complete")

    def test_running_core_is_drained_after_download_and_waits_for_postinstall(self):
        self.assertEqual(self.launch().returncode, 0)
        log, events = self.result()
        self.assertIn("✓", log)
        self.assertEqual(events, ['update', 'available', 'preflight', 'download', 'offline-preflight', 'stop', 'install', 'installed', 'ready', 'rpcd'])
        self.assertEqual((self.root / "state").read_text(), "1")

    def test_start_when_postinstall_did_not_start(self):
        self.launch(POSTINSTALL_START="0")
        log, events = self.result()
        self.assertIn("✓", log)
        self.assertIn("start", events)

    def test_stopped_service_stays_stopped(self):
        self.write("state", "0")
        self.launch()
        log, events = self.result()
        self.assertIn("✓", log)
        self.assertEqual(events.count("stop"), 2)
        self.assertEqual((self.root / "state").read_text(), "0")

    def test_failures_are_not_reported_as_success(self):
        for stage in ('update', 'available', 'preflight', 'download', 'offline-preflight', 'stop', 'install', 'installed', 'ready'):
            with self.subTest(stage=stage):
                self.write("state", "1")
                self.write("events", "")
                self.launch(FAIL_AT=stage)
                log, events = self.result()
                self.assertIn("✗", log)
                self.assertNotIn("✓", log)
                if stage in ('update', 'available', 'preflight', 'download', 'offline-preflight'):
                    self.assertNotIn("stop", events)
                    self.assertEqual((self.root / "state").read_text(), "1")
                if stage == 'stop':
                    self.assertNotIn("install", events)
                self.assertNotIn("rpcd", events)

    def test_installed_old_version_is_not_success(self):
        self.launch(WRONG_VERSION="1")
        log, events = self.result()
        self.assertIn("✗", log)
        self.assertNotIn("ready", events)

    def test_shared_lock_covers_the_whole_upgrade(self):
        self.launch(WAIT_DOWNLOAD="1")
        self.addCleanup(lambda: (self.root / "continue").touch())
        deadline = time.monotonic() + 3
        while 'download' not in (self.root / 'events').read_text().splitlines():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.01)
        result = self.launch(pkg="luci-app-honk")
        self.assertEqual(result.returncode, 75, result.stderr)
        (self.root / "continue").touch()
        self.assertIn("✓", self.result()[0])


class ReadinessTest(unittest.TestCase):
    def test_installed_lifecycle_requires_stable_readiness(self):
        source = (ROOT / "honk/files/lifecycle.sh").read_text()
        mocks = '''sleep() { :; }
honk_lifecycle_managed_pid() { echo 42; }
honk_lifecycle_starttime() { echo 100; }
'''
        for ready in ("true", "false"):
            script = source + '\n' + mocks + f"honk_lifecycle_ready_owned() {{ {ready}; }}\nhonk_lifecycle_wait_ready 3\n"
            result = subprocess.run(["sh", "-c", script], capture_output=True)
            self.assertEqual(result.returncode, int(ready == "false"), result.stderr)


if __name__ == "__main__":
    unittest.main()
