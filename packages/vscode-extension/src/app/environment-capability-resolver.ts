import {
  buildEnvironmentProfile,
  resolveRuntimeCommand,
} from './environment-profile-service';

export interface TerminalCommandCapabilityResolutionInput {
  command: string;
  envPath?: string;
  workspaceRoot?: string;
  workdir?: string;
}

export interface TerminalCommandCapabilityResolution {
  command: string;
  changed: boolean;
  blocked: boolean;
  reason?: string;
  notes: string[];
}

export function resolveTerminalCommandCapabilities(
  input: TerminalCommandCapabilityResolutionInput,
): TerminalCommandCapabilityResolution {
  const profile = buildEnvironmentProfile({
    workspaceRoots: input.workspaceRoot ? [input.workspaceRoot] : [],
    envPath: input.envPath,
  });
  const resolved = resolveRuntimeCommand({
    profile,
    command: input.command,
    workspaceRoot: input.workspaceRoot,
    workdir: input.workdir,
  });

  if (resolved.blocked) {
    return {
      command: input.command,
      changed: false,
      blocked: true,
      reason: resolved.runtimeId === 'python' ? 'missing-python-runtime' : resolved.reason,
      notes: resolved.runtimeId === 'python'
        ? ['当前系统没有可用的 python/python3，不能执行该 Python 验证命令。']
        : resolved.notes,
    };
  }

  return {
    command: resolved.command,
    changed: resolved.command !== input.command,
    blocked: false,
    notes: resolved.notes,
  };
}
