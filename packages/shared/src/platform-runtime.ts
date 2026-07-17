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
