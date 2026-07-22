import type { PlatformProfile } from './agent-protocol';

export interface PlatformRuntimeInput {
  platform?: string;
  env?: Record<string, string | undefined>;
  shellPath?: string;
  lineEnding?: PlatformProfile['lineEnding'];
  caseSensitive?: boolean;
  workspaceKind?: PlatformProfile['workspaceKind'];
}

export interface PathAdapter {
  normalizeWorkspacePath(path: string): string;
  isAbsolute(path: string): boolean;
  join(...parts: string[]): string;
}

export interface ShellAdapter {
  quoteArg(value: string): string;
  buildCommand(command: string, args?: readonly string[]): string;
}

export interface StorageAdapter<T = unknown> {
  read(key: string): Promise<T | undefined>;
  write(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface BrowserBridgeAdapter {
  openLogin(): Promise<boolean>;
  status(): Promise<{ browserReady: boolean; idle: boolean } | undefined>;
}

export interface PlatformRuntimeAdapter {
  readonly profile: PlatformProfile;
  readonly path: PathAdapter;
  readonly shell: ShellAdapter;
}

export type PlatformAdapterProfileKind = 'os' | 'shell' | 'path' | 'storage';
export type PlatformAdapterProfileStatus = 'supported' | 'unsupported';

export interface PlatformAdapterProfile {
  readonly kind: PlatformAdapterProfileKind;
  readonly profile: string;
  readonly status: PlatformAdapterProfileStatus;
  readonly reason?: string;
}

export interface PlatformRuntimeProfileEvaluation {
  readonly supported: boolean;
  readonly adapterProfiles: readonly PlatformAdapterProfile[];
  readonly unsupported: readonly PlatformAdapterProfile[];
}

export type LinuxPlatformConformanceCheckKind =
  | PlatformAdapterProfileKind
  | 'browser-bridge'
  | 'permissions';

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

const LINUX_LOCAL_XDG_PROFILE = 'linux-local-xdg';
const LINUX_CONTAINER_XDG_PROFILE = 'linux-container-xdg';

export class PlatformRuntimeProfileError extends Error {
  readonly code = 'UNSUPPORTED_PLATFORM_PROFILE';

  constructor(readonly evaluation: PlatformRuntimeProfileEvaluation) {
    super(`Unsupported platform runtime profile: ${formatUnsupportedAdapters(evaluation.unsupported)}`);
    this.name = 'PlatformRuntimeProfileError';
  }
}

export function detectPlatformProfile(input: PlatformRuntimeInput = {}): PlatformProfile {
  const platform = normalizePlatform(input.platform);
  const shell = detectShell(input.shellPath ?? input.env?.SHELL ?? input.env?.ComSpec);
  const workspaceKind = input.workspaceKind ?? detectWorkspaceKind(input.env ?? {});
  const pathStyle = platform === 'win32' && workspaceKind !== 'wsl' ? 'windows' : 'posix';
  return {
    os: platform,
    shell,
    pathStyle,
    lineEnding: input.lineEnding ?? (platform === 'win32' ? 'crlf' : 'lf'),
    caseSensitive: input.caseSensitive ?? !(platform === 'win32' || platform === 'darwin'),
    workspaceKind,
  };
}

export function evaluatePlatformRuntimeProfile(profile: PlatformProfile): PlatformRuntimeProfileEvaluation {
  const adapterProfiles: PlatformAdapterProfile[] = [
    profile.os === 'unknown'
      ? unsupportedProfile('os', profile.os, 'unknown-os')
      : supportedProfile('os', profile.os),
    profile.shell === 'unknown'
      ? unsupportedProfile('shell', profile.shell, 'unknown-shell')
      : supportedProfile('shell', profile.shell),
    evaluatePathProfile(profile),
    profile.workspaceKind === 'unknown'
      ? unsupportedProfile('storage', profile.workspaceKind, 'unknown-workspace-kind')
      : supportedProfile('storage', profile.workspaceKind),
  ];
  const unsupported = adapterProfiles.filter(adapter => adapter.status === 'unsupported');
  return {
    supported: unsupported.length === 0,
    adapterProfiles,
    unsupported,
  };
}

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

export function assertPlatformRuntimeProfileSupported(profile: PlatformProfile): void {
  const evaluation = evaluatePlatformRuntimeProfile(profile);
  if (!evaluation.supported) {
    throw new PlatformRuntimeProfileError(evaluation);
  }
}

export function createPlatformRuntimeAdapter(profile: PlatformProfile): PlatformRuntimeAdapter {
  assertPlatformRuntimeProfileSupported(profile);
  return {
    profile,
    path: profile.pathStyle === 'windows' ? new WindowsPathAdapter() : new PosixPathAdapter(),
    shell: profile.shell === 'powershell'
      ? new PowerShellAdapter()
      : profile.shell === 'cmd'
        ? new CmdShellAdapter()
        : new PosixShellAdapter(),
  };
}

function supportedProfile(
  kind: PlatformAdapterProfileKind,
  profile: string,
): PlatformAdapterProfile {
  return { kind, profile, status: 'supported' };
}

function unsupportedProfile(
  kind: PlatformAdapterProfileKind,
  profile: string,
  reason: string,
): PlatformAdapterProfile {
  return { kind, profile, status: 'unsupported', reason };
}

function supportedLinuxProfile(
  kind: LinuxPlatformConformanceCheckKind,
  profile: string,
): LinuxPlatformConformanceCheck {
  return { kind, profile, status: 'supported' };
}

function unsupportedLinuxProfile(
  kind: LinuxPlatformConformanceCheckKind,
  profile: string,
  reason: string,
): LinuxPlatformConformanceCheck {
  return { kind, profile, status: 'unsupported', reason };
}

function evaluatePathProfile(profile: PlatformProfile): PlatformAdapterProfile {
  if (profile.os === 'win32' && profile.workspaceKind !== 'wsl' && profile.pathStyle !== 'windows') {
    return unsupportedProfile('path', profile.pathStyle, 'win32-local-requires-windows-paths');
  }
  if (profile.os !== 'unknown' && profile.os !== 'win32' && profile.pathStyle !== 'posix') {
    return unsupportedProfile('path', profile.pathStyle, `${profile.os}-requires-posix-paths`);
  }
  if (profile.os === 'win32' && profile.workspaceKind === 'wsl' && profile.pathStyle !== 'posix') {
    return unsupportedProfile('path', profile.pathStyle, 'wsl-requires-posix-paths');
  }
  return supportedProfile('path', profile.pathStyle);
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
  if (
    profile.pathStyle === 'posix'
    && profile.lineEnding === 'lf'
    && profile.caseSensitive
    && workspaceRootOk
  ) {
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
  const storageRoot = input.storageRoot
    ?? env.XDG_STATE_HOME
    ?? env.XDG_CONFIG_HOME
    ?? `${home}/.config/devseek`;
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
  if (
    env.DEVSEEK_BROWSER_BRIDGE_URL
    || env.DEVSEEK_BRIDGE_URL
    || env.DEVSEEK_DEEPSEEK_BRIDGE_URL
    || env.DEVSEEK_BRIDGE_PORT
  ) {
    return supportedLinuxProfile('browser-bridge', 'external-bridge-url');
  }
  if (env.DISPLAY || env.WAYLAND_DISPLAY) {
    return supportedLinuxProfile('browser-bridge', 'display-server');
  }
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
    if ((input.bridgeExecutableMode & 0o111) !== 0) {
      return supportedLinuxProfile('permissions', 'bridge-executable');
    }
    return unsupportedLinuxProfile('permissions', 'bridge-executable', 'bridge-executable-not-executable');
  }
  return unsupportedLinuxProfile('permissions', 'bridge-executable', 'bridge-executable-permission-unknown');
}

function isPosixAbsolutePath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\\') && !/^[a-zA-Z]:/.test(value);
}

function formatUnsupportedAdapters(unsupported: readonly PlatformAdapterProfile[]): string {
  return unsupported
    .map(adapter => `${adapter.kind}=${adapter.profile}`)
    .join(', ');
}

export class PosixPathAdapter implements PathAdapter {
  normalizeWorkspacePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
  }

  isAbsolute(path: string): boolean {
    return path.startsWith('/');
  }

  join(...parts: string[]): string {
    return this.normalizeWorkspacePath(parts.filter(Boolean).join('/'));
  }
}

export class WindowsPathAdapter implements PathAdapter {
  normalizeWorkspacePath(path: string): string {
    return path.replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/^\.\\/, '');
  }

  isAbsolute(path: string): boolean {
    return /^[a-zA-Z]:\\/.test(path) || path.startsWith('\\\\');
  }

  join(...parts: string[]): string {
    return this.normalizeWorkspacePath(parts.filter(Boolean).join('\\'));
  }
}

export class PosixShellAdapter implements ShellAdapter {
  quoteArg(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  buildCommand(command: string, args: readonly string[] = []): string {
    return [command, ...args.map(arg => this.quoteArg(arg))].join(' ');
  }
}

export class PowerShellAdapter implements ShellAdapter {
  quoteArg(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  buildCommand(command: string, args: readonly string[] = []): string {
    return [command, ...args.map(arg => this.quoteArg(arg))].join(' ');
  }
}

export class CmdShellAdapter implements ShellAdapter {
  quoteArg(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  buildCommand(command: string, args: readonly string[] = []): string {
    return [command, ...args.map(arg => this.quoteArg(arg))].join(' ');
  }
}

function normalizePlatform(platform: string | undefined): PlatformProfile['os'] {
  if (platform === 'linux' || platform === 'darwin' || platform === 'win32') return platform;
  return 'unknown';
}

function detectShell(shellPath: string | undefined): PlatformProfile['shell'] {
  const shell = (shellPath ?? '').toLowerCase();
  if (shell.includes('powershell') || shell.includes('pwsh')) return 'powershell';
  if (shell.endsWith('cmd.exe') || shell.endsWith('\\cmd')) return 'cmd';
  if (shell.includes('git') && shell.includes('bash')) return 'git-bash';
  if (shell.includes('bash') || shell.includes('zsh') || shell.includes('fish') || shell.includes('/sh')) return 'posix';
  return 'unknown';
}

function detectWorkspaceKind(env: Record<string, string | undefined>): PlatformProfile['workspaceKind'] {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return 'wsl';
  if (env.REMOTE_CONTAINERS || env.DEVCONTAINER) return 'container';
  if (env.VSCODE_REMOTE_CONTAINERS_SESSION || env.SSH_CONNECTION) return 'remote';
  return 'local';
}
