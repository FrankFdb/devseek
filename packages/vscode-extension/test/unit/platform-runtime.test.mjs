/**
 * Contract tests for ARCH-05 Phase 10 PlatformRuntimeAdapter and SurfaceAdapter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function bundle(entry, name) {
  const out = path.join(rootDir, `test/unit/${name}.bundle.cjs`);
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${out} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
  return createRequire(import.meta.url)(out);
}

const runtime = bundle('../shared/src/platform-runtime.ts', 'platform-runtime');
const surface = bundle('../shared/src/surface-adapter.ts', 'surface-adapter');

test('PlatformRuntimeAdapter detects Linux POSIX shell and path behavior', () => {
  const profile = runtime.detectPlatformProfile({
    platform: 'linux',
    shellPath: '/bin/bash',
    env: {},
  });
  const adapter = runtime.createPlatformRuntimeAdapter(profile);

  assert.equal(profile.os, 'linux');
  assert.equal(profile.shell, 'posix');
  assert.equal(profile.pathStyle, 'posix');
  assert.equal(profile.lineEnding, 'lf');
  assert.equal(adapter.path.join('src', 'app', 'x.ts'), 'src/app/x.ts');
  assert.equal(adapter.shell.buildCommand('printf', ["a'b"]), "printf 'a'\\''b'");
});

test('PlatformRuntimeAdapter detects Windows cmd and CRLF defaults', () => {
  const profile = runtime.detectPlatformProfile({
    platform: 'win32',
    shellPath: 'C:\\Windows\\System32\\cmd.exe',
    env: {},
  });
  const adapter = runtime.createPlatformRuntimeAdapter(profile);

  assert.equal(profile.os, 'win32');
  assert.equal(profile.shell, 'cmd');
  assert.equal(profile.pathStyle, 'windows');
  assert.equal(profile.lineEnding, 'crlf');
  assert.equal(profile.caseSensitive, false);
  assert.equal(adapter.path.join('src', 'app', 'x.ts'), 'src\\app\\x.ts');
});

test('PlatformRuntimeAdapter treats WSL workspace as POSIX path on Windows host', () => {
  const profile = runtime.detectPlatformProfile({
    platform: 'win32',
    shellPath: '/bin/bash',
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
  });

  assert.equal(profile.workspaceKind, 'wsl');
  assert.equal(profile.pathStyle, 'posix');
  assert.equal(profile.shell, 'posix');
});

test('SurfaceAdapter creates chat command and reports capability gaps', () => {
  const command = surface.createChatRequestCommand({
    surface: 'jsonl',
    capabilities: surface.JSONL_SURFACE_CAPABILITIES,
    platform: runtime.detectPlatformProfile({ platform: 'linux', shellPath: '/bin/bash', env: {} }),
    prompt: 'phase10',
  });
  const gaps = surface.summarizeSurfaceCapabilityGaps(surface.JSONL_SURFACE_CAPABILITIES, {
    supportsHunkReview: 'hunk-review',
    supportsInlineSelection: 'inline-selection',
    supportsTerminalEmbedding: 'terminal-embedding',
    supportsDiagnostics: 'diagnostics',
  });

  assert.equal(command.type, 'chat.request');
  assert.equal(command.surface, 'jsonl');
  assert.equal(command.request.prompt, 'phase10');
  assert.deepEqual(gaps, ['hunk-review', 'inline-selection', 'terminal-embedding', 'diagnostics']);
});

test('PlatformRuntimeAdapter profiles OS, shell, path, and storage applicability independently', () => {
  const profile = runtime.detectPlatformProfile({
    platform: 'linux',
    shellPath: '/bin/bash',
    env: { DEVCONTAINER: '1' },
  });
  const applicability = runtime.evaluatePlatformRuntimeProfile(profile);

  assert.equal(applicability.supported, true);
  assert.deepEqual(
    applicability.adapterProfiles.map(adapter => adapter.kind),
    ['os', 'shell', 'path', 'storage'],
  );
  assert.equal(applicability.adapterProfiles.every(adapter => adapter.status === 'supported'), true);
});

test('PlatformRuntimeAdapter fails closed for unknown OS or shell before command creation', () => {
  const unknownOs = runtime.detectPlatformProfile({
    platform: 'sunos',
    shellPath: '/bin/bash',
    env: {},
  });
  const unknownShell = runtime.detectPlatformProfile({
    platform: 'linux',
    shellPath: '/opt/custom-shell',
    env: {},
  });

  assert.equal(unknownOs.os, 'unknown');
  assert.equal(unknownShell.shell, 'unknown');
  assert.throws(
    () => runtime.createPlatformRuntimeAdapter(unknownOs),
    /Unsupported platform runtime profile: os=unknown/,
  );
  assert.throws(
    () => runtime.createPlatformRuntimeAdapter(unknownShell),
    /Unsupported platform runtime profile: shell=unknown/,
  );
  assert.throws(
    () => surface.createChatRequestCommand({
      surface: 'vscode',
      capabilities: surface.VSCODE_SURFACE_CAPABILITIES,
      platform: unknownOs,
      prompt: 'must not be accepted',
    }),
    /Unsupported platform runtime profile: os=unknown/,
  );
});

function linuxCheck(report, kind) {
  const check = report.checks.find(item => item.kind === kind);
  assert.ok(check, `missing Linux conformance check: ${kind}`);
  return check;
}

test('R3-08D-LINUX-CONFORMANCE profiles native and container shell path storage browser bridge independently', () => {
  const native = runtime.evaluateLinuxPlatformConformance({
    platform: 'linux',
    shellPath: '/usr/bin/bash',
    env: {
      HOME: '/home/dev',
      XDG_RUNTIME_DIR: '/run/user/1000',
      DISPLAY: ':1',
    },
    workspaceRoot: '/home/dev/work/devseek',
    bridgeExecutableMode: 0o755,
  });
  const container = runtime.evaluateLinuxPlatformConformance({
    platform: 'linux',
    shellPath: '/bin/sh',
    env: {
      HOME: '/home/node',
      DEVCONTAINER: '1',
      DEVSEEK_BROWSER_BRIDGE_URL: 'http://127.0.0.1:3721',
    },
    workspaceRoot: '/workspaces/devseek',
    canExecuteBridge: true,
  });

  assert.equal(native.id, 'R3-08D-LINUX-CONFORMANCE');
  assert.equal(native.supported, true);
  assert.deepEqual(
    native.checks.map(check => check.kind),
    ['os', 'shell', 'path', 'storage', 'browser-bridge', 'permissions'],
  );
  assert.equal(linuxCheck(native, 'storage').profile, 'linux-local-xdg');
  assert.equal(linuxCheck(native, 'browser-bridge').profile, 'display-server');
  assert.equal(linuxCheck(native, 'permissions').profile, 'bridge-executable');

  assert.equal(container.supported, true);
  assert.equal(container.profile.workspaceKind, 'container');
  assert.equal(linuxCheck(container, 'storage').profile, 'linux-container-xdg');
  assert.equal(linuxCheck(container, 'browser-bridge').profile, 'external-bridge-url');
});

test('R3-08D-LINUX-CONFORMANCE reports path storage browser permission and shell fault sequence separately', () => {
  const pathFault = runtime.evaluateLinuxPlatformConformance({
    profile: {
      os: 'linux',
      shell: 'posix',
      pathStyle: 'windows',
      lineEnding: 'crlf',
      caseSensitive: false,
      workspaceKind: 'local',
    },
    env: { HOME: '/home/dev', DISPLAY: ':1' },
    workspaceRoot: 'C:\\devseek',
    canExecuteBridge: true,
  });
  const storageFault = runtime.evaluateLinuxPlatformConformance({
    platform: 'linux',
    shellPath: '/bin/bash',
    env: { DISPLAY: ':1' },
    workspaceRoot: '/home/dev/devseek',
    canExecuteBridge: true,
  });
  const browserFault = runtime.evaluateLinuxPlatformConformance({
    platform: 'linux',
    shellPath: '/bin/bash',
    env: { HOME: '/home/dev' },
    workspaceRoot: '/home/dev/devseek',
    canExecuteBridge: true,
  });
  const permissionFault = runtime.evaluateLinuxPlatformConformance({
    platform: 'linux',
    shellPath: '/bin/bash',
    env: { HOME: '/home/dev', DISPLAY: ':1' },
    workspaceRoot: '/home/dev/devseek',
    bridgeExecutableMode: 0o644,
  });
  const shellFault = runtime.evaluateLinuxPlatformConformance({
    platform: 'linux',
    shellPath: '/opt/custom-shell',
    env: { HOME: '/home/dev', DISPLAY: ':1' },
    workspaceRoot: '/home/dev/devseek',
    canExecuteBridge: true,
  });

  assert.equal(pathFault.supported, false);
  assert.equal(linuxCheck(pathFault, 'path').reason, 'linux-requires-posix-lf-case-sensitive-paths');
  assert.equal(storageFault.supported, false);
  assert.equal(linuxCheck(storageFault, 'storage').reason, 'linux-storage-home-missing');
  assert.equal(browserFault.supported, false);
  assert.equal(linuxCheck(browserFault, 'browser-bridge').reason, 'linux-browser-bridge-unreachable');
  assert.equal(permissionFault.supported, false);
  assert.equal(linuxCheck(permissionFault, 'permissions').reason, 'bridge-executable-not-executable');
  assert.equal(shellFault.supported, false);
  assert.equal(linuxCheck(shellFault, 'shell').reason, 'linux-requires-posix-shell');
});

function windowsWslCheck(report, kind) {
  const check = report.checks.find(item => item.kind === kind);
  assert.ok(check, `missing Windows/WSL conformance check: ${kind}`);
  return check;
}

test('R3-08E-WINDOWS-WSL-CONFORMANCE profiles Windows native and WSL independently', () => {
  const native = runtime.evaluateWindowsWslPlatformConformance({
    platform: 'win32',
    shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    env: {
      USERPROFILE: 'C:\\Users\\dev',
      LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
    },
    workspaceRoot: 'C:\\Users\\dev\\work\\devseek',
    bridgeExecutablePath: 'C:\\Users\\dev\\.vscode\\extensions\\devseek\\bridge\\server.cmd',
    canExecuteBridge: true,
  });
  const wsl = runtime.evaluateWindowsWslPlatformConformance({
    platform: 'win32',
    shellPath: '/bin/bash',
    env: {
      HOME: '/home/dev',
      WSL_DISTRO_NAME: 'Ubuntu',
      WSL_INTEROP: '/run/WSL/123_interop',
    },
    workspaceRoot: '/home/dev/work/devseek',
    bridgeExecutablePath: '/home/dev/.vscode-server/extensions/devseek/bridge/server.js',
    canExecuteBridge: true,
  });

  assert.equal(native.id, 'R3-08E-WINDOWS-WSL-CONFORMANCE');
  assert.equal(native.supported, true);
  assert.deepEqual(
    native.checks.map(check => check.kind),
    ['os', 'shell', 'path', 'line-ending', 'permissions', 'interop'],
  );
  assert.equal(native.profile.workspaceKind, 'local');
  assert.equal(windowsWslCheck(native, 'shell').profile, 'windows-powershell');
  assert.equal(windowsWslCheck(native, 'path').profile, 'windows-native-path');
  assert.equal(windowsWslCheck(native, 'line-ending').profile, 'windows-crlf');
  assert.equal(windowsWslCheck(native, 'interop').profile, 'windows-native-no-wsl');

  assert.equal(wsl.supported, true);
  assert.equal(wsl.profile.workspaceKind, 'wsl');
  assert.equal(windowsWslCheck(wsl, 'shell').profile, 'wsl-posix');
  assert.equal(windowsWslCheck(wsl, 'path').profile, 'wsl-posix-path');
  assert.equal(windowsWslCheck(wsl, 'line-ending').profile, 'wsl-lf');
  assert.equal(windowsWslCheck(wsl, 'interop').profile, 'wsl-interop');
});

test('R3-08E-WINDOWS-WSL-CONFORMANCE reports path line-ending permission interop and shell faults separately', () => {
  const nativePathFault = runtime.evaluateWindowsWslPlatformConformance({
    profile: {
      os: 'win32',
      shell: 'powershell',
      pathStyle: 'posix',
      lineEnding: 'crlf',
      caseSensitive: false,
      workspaceKind: 'local',
    },
    workspaceRoot: '/mnt/c/devseek',
    canExecuteBridge: true,
  });
  const wslPathFault = runtime.evaluateWindowsWslPlatformConformance({
    profile: {
      os: 'win32',
      shell: 'posix',
      pathStyle: 'windows',
      lineEnding: 'lf',
      caseSensitive: true,
      workspaceKind: 'wsl',
    },
    env: { WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/123_interop' },
    workspaceRoot: 'C:\\Users\\dev\\work\\devseek',
    canExecuteBridge: true,
  });
  const lineEndingFault = runtime.evaluateWindowsWslPlatformConformance({
    platform: 'win32',
    shellPath: 'C:\\Windows\\System32\\cmd.exe',
    lineEnding: 'lf',
    env: { USERPROFILE: 'C:\\Users\\dev' },
    workspaceRoot: 'C:\\Users\\dev\\work\\devseek',
    canExecuteBridge: true,
  });
  const interopFault = runtime.evaluateWindowsWslPlatformConformance({
    platform: 'win32',
    shellPath: '/bin/bash',
    env: { HOME: '/home/dev', WSL_DISTRO_NAME: 'Ubuntu' },
    workspaceRoot: '/home/dev/work/devseek',
    canExecuteBridge: true,
  });
  const permissionFault = runtime.evaluateWindowsWslPlatformConformance({
    platform: 'win32',
    shellPath: 'C:\\Windows\\System32\\cmd.exe',
    env: { USERPROFILE: 'C:\\Users\\dev' },
    workspaceRoot: 'C:\\Users\\dev\\work\\devseek',
    bridgeExecutablePath: 'C:\\Users\\dev\\.vscode\\extensions\\devseek\\bridge\\server.cmd',
    canExecuteBridge: false,
  });
  const shellFault = runtime.evaluateWindowsWslPlatformConformance({
    platform: 'win32',
    shellPath: '/bin/bash',
    env: { HOME: '/home/dev' },
    workspaceRoot: 'C:\\Users\\dev\\work\\devseek',
    canExecuteBridge: true,
  });

  assert.equal(nativePathFault.supported, false);
  assert.equal(windowsWslCheck(nativePathFault, 'path').reason, 'windows-native-requires-windows-paths');
  assert.equal(wslPathFault.supported, false);
  assert.equal(windowsWslCheck(wslPathFault, 'path').reason, 'wsl-requires-posix-paths');
  assert.equal(lineEndingFault.supported, false);
  assert.equal(windowsWslCheck(lineEndingFault, 'line-ending').reason, 'windows-native-requires-crlf');
  assert.equal(interopFault.supported, false);
  assert.equal(windowsWslCheck(interopFault, 'interop').reason, 'wsl-interop-missing');
  assert.equal(permissionFault.supported, false);
  assert.equal(windowsWslCheck(permissionFault, 'permissions').reason, 'bridge-executable-not-executable');
  assert.equal(shellFault.supported, false);
  assert.equal(windowsWslCheck(shellFault, 'shell').reason, 'windows-native-requires-powershell-or-cmd');
});

function macOSCheck(report, kind) {
  const check = report.checks.find(item => item.kind === kind);
  assert.ok(check, `missing macOS conformance check: ${kind}`);
  return check;
}

test('R3-08F-MACOS-CONFORMANCE defers non-macOS evidence and profiles macOS independently', () => {
  const linux = runtime.evaluateMacOSPlatformConformance({
    platform: 'linux',
    shellPath: '/bin/bash',
    env: {
      HOME: '/home/dev',
      DISPLAY: ':1',
    },
    workspaceRoot: '/home/dev/work/devseek',
    keychainAvailable: true,
    browserBridgeAvailable: true,
    runtimeAvailable: true,
  });
  const macos = runtime.evaluateMacOSPlatformConformance({
    platform: 'darwin',
    shellPath: '/bin/zsh',
    env: {
      HOME: '/Users/dev',
      DEVSEEK_MACOS_KEYCHAIN: '1',
      DEVSEEK_MACOS_BROWSER_BRIDGE: '1',
    },
    workspaceRoot: '/Users/dev/work/devseek',
    keychainAvailable: true,
    browserBridgeAvailable: true,
    runtimeAvailable: true,
    runtimePath: '/Applications/DevSeek.app/Contents/MacOS/devseek-bridge',
  });

  assert.equal(linux.id, 'R3-08F-MACOS-CONFORMANCE');
  assert.equal(linux.supported, false);
  assert.deepEqual(
    linux.checks.map(check => check.kind),
    ['os', 'shell', 'path', 'keychain', 'browser', 'runtime'],
  );
  assert.deepEqual(
    linux.deferred.map(check => check.kind),
    ['os', 'shell', 'path', 'keychain', 'browser', 'runtime'],
  );
  assert.equal(macOSCheck(linux, 'os').reason, 'r3-08f-macos-environment-deferred');

  assert.equal(macos.supported, true);
  assert.deepEqual(
    macos.checks.map(check => check.kind),
    ['os', 'shell', 'path', 'keychain', 'browser', 'runtime'],
  );
  assert.equal(macOSCheck(macos, 'os').profile, 'macos-darwin');
  assert.equal(macOSCheck(macos, 'shell').profile, 'macos-posix-shell');
  assert.equal(macOSCheck(macos, 'path').profile, 'macos-posix-path');
  assert.equal(macOSCheck(macos, 'keychain').profile, 'macos-keychain');
  assert.equal(macOSCheck(macos, 'browser').profile, 'macos-browser-bridge');
  assert.equal(macOSCheck(macos, 'runtime').profile, 'macos-runtime');
  assert.deepEqual(macos.unsupported, []);
  assert.deepEqual(macos.deferred, []);
});

test('R3-08F-MACOS-CONFORMANCE reports macOS shell path keychain browser and runtime faults separately', () => {
  const shellFault = runtime.evaluateMacOSPlatformConformance({
    platform: 'darwin',
    shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    env: { HOME: '/Users/dev' },
    workspaceRoot: '/Users/dev/work/devseek',
    keychainAvailable: true,
    browserBridgeAvailable: true,
    runtimeAvailable: true,
  });
  const pathFault = runtime.evaluateMacOSPlatformConformance({
    profile: {
      os: 'darwin',
      shell: 'posix',
      pathStyle: 'windows',
      lineEnding: 'lf',
      caseSensitive: false,
      workspaceKind: 'local',
    },
    workspaceRoot: 'C:\\Users\\dev\\work\\devseek',
    keychainAvailable: true,
    browserBridgeAvailable: true,
    runtimeAvailable: true,
  });
  const keychainFault = runtime.evaluateMacOSPlatformConformance({
    platform: 'darwin',
    shellPath: '/bin/zsh',
    env: { HOME: '/Users/dev' },
    workspaceRoot: '/Users/dev/work/devseek',
    keychainAvailable: false,
    browserBridgeAvailable: true,
    runtimeAvailable: true,
  });
  const browserDeferred = runtime.evaluateMacOSPlatformConformance({
    platform: 'darwin',
    shellPath: '/bin/zsh',
    env: { HOME: '/Users/dev', DEVSEEK_MACOS_KEYCHAIN: '1' },
    workspaceRoot: '/Users/dev/work/devseek',
    keychainAvailable: true,
    runtimeAvailable: true,
  });
  const runtimeFault = runtime.evaluateMacOSPlatformConformance({
    platform: 'darwin',
    shellPath: '/bin/zsh',
    env: {
      HOME: '/Users/dev',
      DEVSEEK_MACOS_KEYCHAIN: '1',
      DEVSEEK_MACOS_BROWSER_BRIDGE: '1',
    },
    workspaceRoot: '/Users/dev/work/devseek',
    keychainAvailable: true,
    browserBridgeAvailable: true,
    runtimeAvailable: false,
  });

  assert.equal(shellFault.supported, false);
  assert.equal(macOSCheck(shellFault, 'shell').reason, 'macos-requires-posix-shell');
  assert.equal(pathFault.supported, false);
  assert.equal(macOSCheck(pathFault, 'path').reason, 'macos-requires-posix-paths');
  assert.equal(keychainFault.supported, false);
  assert.equal(macOSCheck(keychainFault, 'keychain').reason, 'macos-keychain-unavailable');
  assert.equal(browserDeferred.supported, false);
  assert.equal(macOSCheck(browserDeferred, 'browser').status, 'deferred');
  assert.equal(macOSCheck(browserDeferred, 'browser').reason, 'macos-browser-bridge-evidence-deferred');
  assert.equal(runtimeFault.supported, false);
  assert.equal(macOSCheck(runtimeFault, 'runtime').reason, 'macos-runtime-unavailable');
});
