import type { PlatformProfile } from './agent-protocol';
import {
  detectPlatformProfile,
  evaluatePlatformRuntimeProfile,
  type PlatformAdapterProfileKind,
  type PlatformAdapterProfileStatus,
  type PlatformRuntimeInput,
  type PlatformRuntimeProfileEvaluation,
} from './platform-runtime';

export const CODING_PLATFORM_ADAPTER_CONFORMANCE_VERSION = 'devseek.coding-platform-adapter-conformance/v1' as const;
export type PlatformConformanceStatus = PlatformAdapterProfileStatus | 'deferred';

export type CodingPlatformBoundaryKind = 'sandbox' | 'workspace-mutation' | 'external-effect';

export interface CodingPlatformBoundaryObservation {
  readonly kind: CodingPlatformBoundaryKind;
  readonly adapterId: string;
  readonly status: PlatformConformanceStatus;
  readonly reason?: string;
  readonly evidenceRefs?: readonly string[];
}

export interface CodingPlatformAdapterConformanceInput {
  readonly profile: PlatformProfile;
  readonly boundaries: readonly CodingPlatformBoundaryObservation[];
}

export interface CodingPlatformAdapterConformanceReport {
  readonly version: typeof CODING_PLATFORM_ADAPTER_CONFORMANCE_VERSION;
  readonly profile: PlatformProfile;
  readonly runtime: PlatformRuntimeProfileEvaluation;
  readonly boundaries: readonly CodingPlatformBoundaryObservation[];
  readonly unsupportedBoundaries: readonly CodingPlatformBoundaryObservation[];
  readonly deferredBoundaries: readonly CodingPlatformBoundaryObservation[];
  readonly supported: boolean;
}

export interface PlatformAdapterConformancePort {
  certify(input: CodingPlatformAdapterConformanceInput): CodingPlatformAdapterConformanceReport;
}

const REQUIRED_BOUNDARIES: readonly CodingPlatformBoundaryKind[] = Object.freeze([
  'sandbox',
  'workspace-mutation',
  'external-effect',
]);

export class CanonicalPlatformAdapterConformanceService implements PlatformAdapterConformancePort {
  certify(input: CodingPlatformAdapterConformanceInput): CodingPlatformAdapterConformanceReport {
    const runtime = evaluatePlatformRuntimeProfile(input.profile);
    const byKind = new Map<CodingPlatformBoundaryKind, CodingPlatformBoundaryObservation>();
    const duplicates = new Set<CodingPlatformBoundaryKind>();
    for (const observation of input.boundaries) {
      if (byKind.has(observation.kind)) duplicates.add(observation.kind);
      byKind.set(observation.kind, snapshotBoundary(observation));
    }
    const boundaries = REQUIRED_BOUNDARIES.map(kind => {
      if (duplicates.has(kind)) {
        return snapshotBoundary({
          kind,
          adapterId: byKind.get(kind)?.adapterId ?? 'unknown',
          status: 'unsupported',
          reason: 'duplicate-platform-boundary-observation',
        });
      }
      return byKind.get(kind) ?? snapshotBoundary({
        kind,
        adapterId: 'unobserved',
        status: 'deferred',
        reason: 'platform-boundary-observation-missing',
      });
    });
    const unsupportedBoundaries = boundaries.filter(boundary => boundary.status === 'unsupported');
    const deferredBoundaries = boundaries.filter(boundary => boundary.status === 'deferred');
    return Object.freeze({
      version: CODING_PLATFORM_ADAPTER_CONFORMANCE_VERSION,
      profile: Object.freeze({ ...input.profile }),
      runtime: snapshotRuntimeEvaluation(runtime),
      boundaries: Object.freeze(boundaries),
      unsupportedBoundaries: Object.freeze(unsupportedBoundaries),
      deferredBoundaries: Object.freeze(deferredBoundaries),
      supported: runtime.supported
        && unsupportedBoundaries.length === 0
        && deferredBoundaries.length === 0,
    });
  }
}

export type LinuxPlatformConformanceCheckKind = PlatformAdapterProfileKind | 'browser-bridge' | 'permissions';

export interface LinuxPlatformConformanceInput extends PlatformRuntimeInput {
  readonly profile?: PlatformProfile;
  readonly workspaceRoot?: string;
  readonly storageRoot?: string;
  readonly bridgeExecutableMode?: number;
  readonly canExecuteBridge?: boolean;
}

export interface LinuxPlatformConformanceCheck {
  readonly kind: LinuxPlatformConformanceCheckKind;
  readonly profile: string;
  readonly status: PlatformAdapterProfileStatus;
  readonly reason?: string;
}

export interface LinuxPlatformConformanceReport {
  readonly id: 'R3-08D-LINUX-CONFORMANCE';
  readonly profile: PlatformProfile;
  readonly supported: boolean;
  readonly checks: readonly LinuxPlatformConformanceCheck[];
  readonly unsupported: readonly LinuxPlatformConformanceCheck[];
}

export type WindowsWslPlatformConformanceCheckKind = PlatformAdapterProfileKind | 'line-ending' | 'permissions' | 'interop';

export interface WindowsWslPlatformConformanceInput extends PlatformRuntimeInput {
  readonly profile?: PlatformProfile;
  readonly workspaceRoot?: string;
  readonly bridgeExecutablePath?: string;
  readonly canExecuteBridge?: boolean;
  readonly wslInteropAvailable?: boolean;
}

export interface WindowsWslPlatformConformanceCheck {
  readonly kind: WindowsWslPlatformConformanceCheckKind;
  readonly profile: string;
  readonly status: PlatformAdapterProfileStatus;
  readonly reason?: string;
}

export interface WindowsWslPlatformConformanceReport {
  readonly id: 'R3-08E-WINDOWS-WSL-CONFORMANCE';
  readonly profile: PlatformProfile;
  readonly supported: boolean;
  readonly checks: readonly WindowsWslPlatformConformanceCheck[];
  readonly unsupported: readonly WindowsWslPlatformConformanceCheck[];
}

export type MacOSPlatformConformanceCheckKind = 'os' | 'shell' | 'path' | 'keychain' | 'browser' | 'runtime';

export interface MacOSPlatformConformanceInput extends PlatformRuntimeInput {
  readonly profile?: PlatformProfile;
  readonly workspaceRoot?: string;
  readonly keychainAvailable?: boolean;
  readonly browserBridgeAvailable?: boolean;
  readonly runtimeAvailable?: boolean;
  readonly runtimePath?: string;
}

export interface MacOSPlatformConformanceCheck {
  readonly kind: MacOSPlatformConformanceCheckKind;
  readonly profile: string;
  readonly status: PlatformConformanceStatus;
  readonly reason?: string;
}

export interface MacOSPlatformConformanceReport {
  readonly id: 'R3-08F-MACOS-CONFORMANCE';
  readonly profile: PlatformProfile;
  readonly supported: boolean;
  readonly checks: readonly MacOSPlatformConformanceCheck[];
  readonly unsupported: readonly MacOSPlatformConformanceCheck[];
  readonly deferred: readonly MacOSPlatformConformanceCheck[];
}

const LINUX_LOCAL_XDG_PROFILE = 'linux-local-xdg';
const LINUX_CONTAINER_XDG_PROFILE = 'linux-container-xdg';
const WINDOWS_NATIVE_PATH_PROFILE = 'windows-native-path';
const WSL_POSIX_PATH_PROFILE = 'wsl-posix-path';
const WINDOWS_CRLF_PROFILE = 'windows-crlf';
const WSL_LF_PROFILE = 'wsl-lf';
const WINDOWS_NATIVE_INTEROP_PROFILE = 'windows-native-no-wsl';
const WSL_INTEROP_PROFILE = 'wsl-interop';
const MACOS_DARWIN_PROFILE = 'macos-darwin';
const MACOS_POSIX_SHELL_PROFILE = 'macos-posix-shell';
const MACOS_POSIX_PATH_PROFILE = 'macos-posix-path';
const MACOS_KEYCHAIN_PROFILE = 'macos-keychain';
const MACOS_BROWSER_BRIDGE_PROFILE = 'macos-browser-bridge';
const MACOS_RUNTIME_PROFILE = 'macos-runtime';

export function evaluateLinuxPlatformConformance(
  input: LinuxPlatformConformanceInput = {},
): LinuxPlatformConformanceReport {
  const profile = input.profile ?? detectPlatformProfile(input);
  const checks: LinuxPlatformConformanceCheck[] = [
    evaluateLinuxOsConformance(profile),
    evaluateLinuxShellConformance(profile),
    evaluateLinuxPathConformance(profile, input.workspaceRoot),
    evaluateLinuxStorageConformance(profile, input),
    evaluateLinuxBrowserBridgeConformance(input),
    evaluateLinuxBridgePermissionConformance(input),
  ];
  const unsupported = checks.filter(check => check.status === 'unsupported');
  return {
    id: 'R3-08D-LINUX-CONFORMANCE',
    profile,
    supported: unsupported.length === 0,
    checks,
    unsupported,
  };
}

export function evaluateWindowsWslPlatformConformance(
  input: WindowsWslPlatformConformanceInput = {},
): WindowsWslPlatformConformanceReport {
  const profile = input.profile ?? detectPlatformProfile(input);
  const checks: WindowsWslPlatformConformanceCheck[] = [
    evaluateWindowsWslOsConformance(profile),
    evaluateWindowsWslShellConformance(profile),
    evaluateWindowsWslPathConformance(profile, input.workspaceRoot),
    evaluateWindowsWslLineEndingConformance(profile),
    evaluateWindowsWslBridgePermissionConformance(input),
    evaluateWindowsWslInteropConformance(profile, input),
  ];
  const unsupported = checks.filter(check => check.status === 'unsupported');
  return {
    id: 'R3-08E-WINDOWS-WSL-CONFORMANCE',
    profile,
    supported: unsupported.length === 0,
    checks,
    unsupported,
  };
}

export function evaluateMacOSPlatformConformance(
  input: MacOSPlatformConformanceInput = {},
): MacOSPlatformConformanceReport {
  const profile = input.profile ?? detectPlatformProfile(input);
  const checks: MacOSPlatformConformanceCheck[] = profile.os === 'darwin'
    ? [
      evaluateMacOSOsConformance(profile),
      evaluateMacOSShellConformance(profile),
      evaluateMacOSPathConformance(profile, input.workspaceRoot),
      evaluateMacOSKeychainConformance(input),
      evaluateMacOSBrowserConformance(input),
      evaluateMacOSRuntimeConformance(input),
    ]
    : createDeferredMacOSEnvironmentChecks();
  const unsupported = checks.filter(check => check.status === 'unsupported');
  const deferred = checks.filter(check => check.status === 'deferred');
  return {
    id: 'R3-08F-MACOS-CONFORMANCE',
    profile,
    supported: unsupported.length === 0 && deferred.length === 0,
    checks,
    unsupported,
    deferred,
  };
}

function snapshotBoundary(value: CodingPlatformBoundaryObservation): CodingPlatformBoundaryObservation {
  return Object.freeze({
    kind: value.kind,
    adapterId: String(value.adapterId || 'unknown'),
    status: value.status,
    ...(value.reason ? { reason: value.reason } : {}),
    ...(value.evidenceRefs ? { evidenceRefs: Object.freeze([...new Set(value.evidenceRefs)]) } : {}),
  });
}

function snapshotRuntimeEvaluation(value: PlatformRuntimeProfileEvaluation): PlatformRuntimeProfileEvaluation {
  const adapterProfiles = value.adapterProfiles.map(profile => Object.freeze({ ...profile }));
  return Object.freeze({
    supported: value.supported,
    adapterProfiles: Object.freeze(adapterProfiles),
    unsupported: Object.freeze(adapterProfiles.filter(profile => profile.status === 'unsupported')),
  });
}

function supportedLinuxProfile(kind: LinuxPlatformConformanceCheckKind, profile: string): LinuxPlatformConformanceCheck {
  return { kind, profile, status: 'supported' };
}

function unsupportedLinuxProfile(
  kind: LinuxPlatformConformanceCheckKind,
  profile: string,
  reason: string,
): LinuxPlatformConformanceCheck {
  return { kind, profile, status: 'unsupported', reason };
}

function supportedWindowsWslProfile(
  kind: WindowsWslPlatformConformanceCheckKind,
  profile: string,
): WindowsWslPlatformConformanceCheck {
  return { kind, profile, status: 'supported' };
}

function unsupportedWindowsWslProfile(
  kind: WindowsWslPlatformConformanceCheckKind,
  profile: string,
  reason: string,
): WindowsWslPlatformConformanceCheck {
  return { kind, profile, status: 'unsupported', reason };
}

function supportedMacOSProfile(kind: MacOSPlatformConformanceCheckKind, profile: string): MacOSPlatformConformanceCheck {
  return { kind, profile, status: 'supported' };
}

function unsupportedMacOSProfile(
  kind: MacOSPlatformConformanceCheckKind,
  profile: string,
  reason: string,
): MacOSPlatformConformanceCheck {
  return { kind, profile, status: 'unsupported', reason };
}

function deferredMacOSProfile(
  kind: MacOSPlatformConformanceCheckKind,
  profile: string,
  reason: string,
): MacOSPlatformConformanceCheck {
  return { kind, profile, status: 'deferred', reason };
}

function evaluateLinuxOsConformance(profile: PlatformProfile): LinuxPlatformConformanceCheck {
  if (profile.os === 'linux') return supportedLinuxProfile('os', profile.os);
  return unsupportedLinuxProfile('os', profile.os, 'r3-08d-linux-only');
}

function evaluateLinuxShellConformance(profile: PlatformProfile): LinuxPlatformConformanceCheck {
  if (profile.shell === 'posix') return supportedLinuxProfile('shell', profile.shell);
  return unsupportedLinuxProfile('shell', profile.shell, 'linux-requires-posix-shell');
}

function evaluateLinuxPathConformance(
  profile: PlatformProfile,
  workspaceRoot: string | undefined,
): LinuxPlatformConformanceCheck {
  const workspaceRootOk = !workspaceRoot || isPosixAbsolutePath(workspaceRoot);
  if (profile.pathStyle === 'posix' && profile.lineEnding === 'lf' && profile.caseSensitive && workspaceRootOk) {
    return supportedLinuxProfile('path', 'linux-posix-lf-case-sensitive');
  }
  return unsupportedLinuxProfile('path', profile.pathStyle, 'linux-requires-posix-lf-case-sensitive-paths');
}

function evaluateLinuxStorageConformance(
  profile: PlatformProfile,
  input: LinuxPlatformConformanceInput,
): LinuxPlatformConformanceCheck {
  const env = input.env ?? {};
  if (profile.workspaceKind !== 'local' && profile.workspaceKind !== 'container') {
    return unsupportedLinuxProfile('storage', profile.workspaceKind, 'linux-storage-workspace-kind-deferred');
  }
  const home = env.HOME;
  if (!home || !isPosixAbsolutePath(home)) {
    return unsupportedLinuxProfile('storage', 'linux-storage', 'linux-storage-home-missing');
  }
  const storageRoot = input.storageRoot ?? env.XDG_STATE_HOME ?? env.XDG_CONFIG_HOME ?? `${home}/.config/devseek`;
  if (!isPosixAbsolutePath(storageRoot)) {
    return unsupportedLinuxProfile('storage', 'linux-storage', 'linux-storage-root-not-posix-absolute');
  }
  return supportedLinuxProfile(
    'storage',
    profile.workspaceKind === 'container' ? LINUX_CONTAINER_XDG_PROFILE : LINUX_LOCAL_XDG_PROFILE,
  );
}

function evaluateLinuxBrowserBridgeConformance(
  input: LinuxPlatformConformanceInput,
): LinuxPlatformConformanceCheck {
  const env = input.env ?? {};
  if (env.DEVSEEK_BROWSER_BRIDGE_URL || env.DEVSEEK_BRIDGE_URL || env.DEVSEEK_DEEPSEEK_BRIDGE_URL || env.DEVSEEK_BRIDGE_PORT) {
    return supportedLinuxProfile('browser-bridge', 'external-bridge-url');
  }
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return supportedLinuxProfile('browser-bridge', 'display-server');
  return unsupportedLinuxProfile('browser-bridge', 'linux-browser-bridge', 'linux-browser-bridge-unreachable');
}

function evaluateLinuxBridgePermissionConformance(
  input: LinuxPlatformConformanceInput,
): LinuxPlatformConformanceCheck {
  if (input.canExecuteBridge === true) return supportedLinuxProfile('permissions', 'bridge-executable');
  if (input.canExecuteBridge === false) {
    return unsupportedLinuxProfile('permissions', 'bridge-executable', 'bridge-executable-not-executable');
  }
  if (typeof input.bridgeExecutableMode === 'number' && Number.isFinite(input.bridgeExecutableMode)) {
    if ((input.bridgeExecutableMode & 0o111) !== 0) return supportedLinuxProfile('permissions', 'bridge-executable');
    return unsupportedLinuxProfile('permissions', 'bridge-executable', 'bridge-executable-not-executable');
  }
  return unsupportedLinuxProfile('permissions', 'bridge-executable', 'bridge-executable-permission-unknown');
}

function evaluateWindowsWslOsConformance(profile: PlatformProfile): WindowsWslPlatformConformanceCheck {
  if (profile.os === 'win32') return supportedWindowsWslProfile('os', profile.os);
  return unsupportedWindowsWslProfile('os', profile.os, 'r3-08e-windows-wsl-only');
}

function evaluateWindowsWslShellConformance(profile: PlatformProfile): WindowsWslPlatformConformanceCheck {
  if (profile.workspaceKind === 'wsl') {
    if (profile.shell === 'posix') return supportedWindowsWslProfile('shell', 'wsl-posix');
    return unsupportedWindowsWslProfile('shell', profile.shell, 'wsl-requires-posix-shell');
  }
  if (profile.shell === 'powershell') return supportedWindowsWslProfile('shell', 'windows-powershell');
  if (profile.shell === 'cmd') return supportedWindowsWslProfile('shell', 'windows-cmd');
  return unsupportedWindowsWslProfile('shell', profile.shell, 'windows-native-requires-powershell-or-cmd');
}

function evaluateWindowsWslPathConformance(
  profile: PlatformProfile,
  workspaceRoot: string | undefined,
): WindowsWslPlatformConformanceCheck {
  if (profile.workspaceKind === 'wsl') {
    if (profile.pathStyle === 'posix' && (!workspaceRoot || isPosixAbsolutePath(workspaceRoot))) {
      return supportedWindowsWslProfile('path', WSL_POSIX_PATH_PROFILE);
    }
    return unsupportedWindowsWslProfile('path', profile.pathStyle, 'wsl-requires-posix-paths');
  }
  if (profile.pathStyle === 'windows' && (!workspaceRoot || isWindowsAbsolutePath(workspaceRoot))) {
    return supportedWindowsWslProfile('path', WINDOWS_NATIVE_PATH_PROFILE);
  }
  return unsupportedWindowsWslProfile('path', profile.pathStyle, 'windows-native-requires-windows-paths');
}

function evaluateWindowsWslLineEndingConformance(profile: PlatformProfile): WindowsWslPlatformConformanceCheck {
  if (profile.workspaceKind === 'wsl') {
    if (profile.lineEnding === 'lf') return supportedWindowsWslProfile('line-ending', WSL_LF_PROFILE);
    return unsupportedWindowsWslProfile('line-ending', profile.lineEnding, 'wsl-requires-lf');
  }
  if (profile.lineEnding === 'crlf') return supportedWindowsWslProfile('line-ending', WINDOWS_CRLF_PROFILE);
  return unsupportedWindowsWslProfile('line-ending', profile.lineEnding, 'windows-native-requires-crlf');
}

function evaluateWindowsWslBridgePermissionConformance(
  input: WindowsWslPlatformConformanceInput,
): WindowsWslPlatformConformanceCheck {
  if (input.canExecuteBridge === true) return supportedWindowsWslProfile('permissions', 'bridge-executable');
  if (input.canExecuteBridge === false) {
    return unsupportedWindowsWslProfile('permissions', 'bridge-executable', 'bridge-executable-not-executable');
  }
  return unsupportedWindowsWslProfile('permissions', 'bridge-executable', 'bridge-executable-permission-unknown');
}

function evaluateWindowsWslInteropConformance(
  profile: PlatformProfile,
  input: WindowsWslPlatformConformanceInput,
): WindowsWslPlatformConformanceCheck {
  const env = input.env ?? {};
  if (profile.workspaceKind === 'wsl') {
    if (input.wslInteropAvailable === true || Boolean(env.WSL_INTEROP)) {
      return supportedWindowsWslProfile('interop', WSL_INTEROP_PROFILE);
    }
    return unsupportedWindowsWslProfile('interop', 'wsl-interop', 'wsl-interop-missing');
  }
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP || input.wslInteropAvailable === true) {
    return unsupportedWindowsWslProfile('interop', 'windows-native-interop', 'windows-native-wsl-env-present');
  }
  return supportedWindowsWslProfile('interop', WINDOWS_NATIVE_INTEROP_PROFILE);
}

function createDeferredMacOSEnvironmentChecks(): MacOSPlatformConformanceCheck[] {
  const reason = 'r3-08f-macos-environment-deferred';
  return [
    deferredMacOSProfile('os', MACOS_DARWIN_PROFILE, reason),
    deferredMacOSProfile('shell', MACOS_POSIX_SHELL_PROFILE, reason),
    deferredMacOSProfile('path', MACOS_POSIX_PATH_PROFILE, reason),
    deferredMacOSProfile('keychain', MACOS_KEYCHAIN_PROFILE, reason),
    deferredMacOSProfile('browser', MACOS_BROWSER_BRIDGE_PROFILE, reason),
    deferredMacOSProfile('runtime', MACOS_RUNTIME_PROFILE, reason),
  ];
}

function evaluateMacOSOsConformance(profile: PlatformProfile): MacOSPlatformConformanceCheck {
  if (profile.os === 'darwin') return supportedMacOSProfile('os', MACOS_DARWIN_PROFILE);
  return deferredMacOSProfile('os', MACOS_DARWIN_PROFILE, 'r3-08f-macos-environment-deferred');
}

function evaluateMacOSShellConformance(profile: PlatformProfile): MacOSPlatformConformanceCheck {
  if (profile.shell === 'posix') return supportedMacOSProfile('shell', MACOS_POSIX_SHELL_PROFILE);
  return unsupportedMacOSProfile('shell', profile.shell, 'macos-requires-posix-shell');
}

function evaluateMacOSPathConformance(
  profile: PlatformProfile,
  workspaceRoot: string | undefined,
): MacOSPlatformConformanceCheck {
  if (profile.pathStyle === 'posix' && (!workspaceRoot || isPosixAbsolutePath(workspaceRoot))) {
    return supportedMacOSProfile('path', MACOS_POSIX_PATH_PROFILE);
  }
  return unsupportedMacOSProfile('path', profile.pathStyle, 'macos-requires-posix-paths');
}

function evaluateMacOSKeychainConformance(input: MacOSPlatformConformanceInput): MacOSPlatformConformanceCheck {
  const env = input.env ?? {};
  if (input.keychainAvailable === true || env.DEVSEEK_MACOS_KEYCHAIN === '1') {
    return supportedMacOSProfile('keychain', MACOS_KEYCHAIN_PROFILE);
  }
  if (input.keychainAvailable === false || env.DEVSEEK_MACOS_KEYCHAIN === '0') {
    return unsupportedMacOSProfile('keychain', MACOS_KEYCHAIN_PROFILE, 'macos-keychain-unavailable');
  }
  return deferredMacOSProfile('keychain', MACOS_KEYCHAIN_PROFILE, 'macos-keychain-evidence-deferred');
}

function evaluateMacOSBrowserConformance(input: MacOSPlatformConformanceInput): MacOSPlatformConformanceCheck {
  const env = input.env ?? {};
  if (
    input.browserBridgeAvailable === true
    || env.DEVSEEK_MACOS_BROWSER_BRIDGE === '1'
    || env.DEVSEEK_BROWSER_BRIDGE_URL
    || env.DEVSEEK_BRIDGE_URL
    || env.DEVSEEK_DEEPSEEK_BRIDGE_URL
  ) {
    return supportedMacOSProfile('browser', MACOS_BROWSER_BRIDGE_PROFILE);
  }
  if (input.browserBridgeAvailable === false || env.DEVSEEK_MACOS_BROWSER_BRIDGE === '0') {
    return unsupportedMacOSProfile('browser', MACOS_BROWSER_BRIDGE_PROFILE, 'macos-browser-bridge-unavailable');
  }
  return deferredMacOSProfile('browser', MACOS_BROWSER_BRIDGE_PROFILE, 'macos-browser-bridge-evidence-deferred');
}

function evaluateMacOSRuntimeConformance(input: MacOSPlatformConformanceInput): MacOSPlatformConformanceCheck {
  const env = input.env ?? {};
  const runtimePath = input.runtimePath ?? env.DEVSEEK_MACOS_RUNTIME_PATH;
  if (runtimePath && !isPosixAbsolutePath(runtimePath)) {
    return unsupportedMacOSProfile('runtime', MACOS_RUNTIME_PROFILE, 'macos-runtime-requires-posix-path');
  }
  if (input.runtimeAvailable === true || env.DEVSEEK_MACOS_RUNTIME === '1' || runtimePath) {
    return supportedMacOSProfile('runtime', MACOS_RUNTIME_PROFILE);
  }
  if (input.runtimeAvailable === false || env.DEVSEEK_MACOS_RUNTIME === '0') {
    return unsupportedMacOSProfile('runtime', MACOS_RUNTIME_PROFILE, 'macos-runtime-unavailable');
  }
  return deferredMacOSProfile('runtime', MACOS_RUNTIME_PROFILE, 'macos-runtime-evidence-deferred');
}

function isPosixAbsolutePath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\\') && !/^[a-zA-Z]:/.test(value);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}
