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

export function createPlatformRuntimeAdapter(profile: PlatformProfile): PlatformRuntimeAdapter {
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
