import type {
  AgentChatRequest,
  AgentCommand,
  AgentCommandBase,
  AgentSurfaceKind,
  ChatRequestCommand,
  PlatformProfile,
  SurfaceCapabilities,
} from './agent-protocol';
import { assertPlatformRuntimeProfileSupported } from './platform-runtime';

export const AGENT_COMMAND_VERSION = 'devseek.agent-command/v1' as const;

export type CanonicalAgentCommand<T extends AgentCommand = AgentCommand> = T & {
  readonly version: typeof AGENT_COMMAND_VERSION;
};

export interface AgentCommandPort {
  accept<T extends AgentCommand>(command: T): CanonicalAgentCommand<T>;
}

/**
 * Semantic owner for commands entering the Agent application boundary. It
 * snapshots transport input without deciding the downstream feature policy.
 */
export class CanonicalAgentCommandService implements AgentCommandPort {
  accept<T extends AgentCommand>(command: T): CanonicalAgentCommand<T> {
    if (!command || typeof command !== 'object') commandFailure('invalid-command');
    const base = snapshotCommandBase(command);
    let accepted: CanonicalAgentCommand;
    switch (command.type) {
      case 'chat.request':
        accepted = Object.freeze({
          ...base,
          version: AGENT_COMMAND_VERSION,
          type: command.type,
          request: snapshotChatRequest(command.request),
        });
        break;
      case 'plan.reviewDecision':
        accepted = Object.freeze({
          ...base,
          version: AGENT_COMMAND_VERSION,
          type: command.type,
          taskId: requireText(command.taskId, 'missing-task-id'),
          decision: requireEnum(command.decision, ['approve', 'revise', 'cancel'], 'invalid-plan-decision'),
          ...(command.comment === undefined
            ? {}
            : { comment: requireText(command.comment, 'invalid-plan-comment') }),
        });
        break;
      case 'permission.decision':
        accepted = Object.freeze({
          ...base,
          version: AGENT_COMMAND_VERSION,
          type: command.type,
          requestId: requireText(command.requestId, 'missing-permission-request-id'),
          decision: requireEnum(command.decision, ['allow', 'deny'], 'invalid-permission-decision'),
        });
        break;
      case 'task.resume':
        accepted = Object.freeze({
          ...base,
          version: AGENT_COMMAND_VERSION,
          type: command.type,
          ...(command.checkpointId === undefined
            ? {}
            : { checkpointId: requireText(command.checkpointId, 'invalid-checkpoint-id') }),
        });
        break;
      case 'task.cancel':
        accepted = Object.freeze({
          ...base,
          version: AGENT_COMMAND_VERSION,
          type: command.type,
          ...(command.taskId === undefined
            ? {}
            : { taskId: requireText(command.taskId, 'invalid-cancel-task-id') }),
        });
        break;
      default:
        commandFailure(`unsupported-type:${String((command as { type?: unknown }).type)}`);
    }
    return accepted as CanonicalAgentCommand<T>;
  }
}

const COMMANDS = new CanonicalAgentCommandService();

export function acceptAgentCommand<T extends AgentCommand>(command: T): CanonicalAgentCommand<T> {
  return COMMANDS.accept(command);
}

function snapshotCommandBase(command: AgentCommandBase): Readonly<AgentCommandBase> {
  const createdAt = command.createdAt;
  if (createdAt !== undefined && (!Number.isFinite(createdAt) || createdAt < 0)) {
    commandFailure('invalid-created-at');
  }
  return Object.freeze({
    commandId: requireText(command.commandId, 'missing-command-id'),
    surface: requireSurface(command.surface),
    ...(command.capabilities === undefined
      ? {}
      : { capabilities: snapshotCapabilities(command.capabilities) }),
    ...(command.platform === undefined ? {} : { platform: snapshotPlatform(command.platform) }),
    ...(createdAt === undefined ? {} : { createdAt }),
  });
}

function snapshotChatRequest(request: AgentChatRequest): Readonly<AgentChatRequest> {
  if (!request || typeof request !== 'object') commandFailure('missing-chat-request');
  return Object.freeze({
    prompt: requireText(request.prompt, 'missing-chat-prompt'),
    ...optionalBoolean('newSession', request.newSession),
    ...optionalEnum('mode', request.mode, ['fast', 'r1'] as const),
    ...optionalTextArray('files', request.files),
    ...optionalBoolean('stream', request.stream),
    ...optionalFunction('onDelta', request.onDelta),
    ...optionalPositiveNumber('timeoutMs', request.timeoutMs),
    ...optionalBoolean('trackHistory', request.trackHistory),
    ...(request.displayPrompt === undefined
      ? {}
      : { displayPrompt: requirePrimitiveText(request.displayPrompt, 'invalid-display-prompt') }),
    ...optionalFunction('onUsage', request.onUsage),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...optionalTextArray('images', request.images),
    ...optionalText('traceRunId', request.traceRunId),
    ...optionalText('traceWorkspaceRoot', request.traceWorkspaceRoot),
    ...optionalText('traceOperationId', request.traceOperationId),
    ...optionalText('traceEvidenceParticipantToken', request.traceEvidenceParticipantToken),
    ...optionalFunction('onTraceEvidenceError', request.onTraceEvidenceError),
  });
}

function snapshotCapabilities(value: SurfaceCapabilities): Readonly<SurfaceCapabilities> {
  const keys: readonly (keyof SurfaceCapabilities)[] = [
    'supportsHunkReview',
    'supportsInlineSelection',
    'supportsTerminalEmbedding',
    'supportsBrowserPreview',
    'supportsJsonl',
    'supportsDiagnostics',
  ];
  const snapshot = Object.fromEntries(keys.map(key => {
    if (typeof value[key] !== 'boolean') commandFailure(`invalid-capability:${key}`);
    return [key, value[key]];
  })) as unknown as SurfaceCapabilities;
  return Object.freeze(snapshot);
}

function snapshotPlatform(value: PlatformProfile): Readonly<PlatformProfile> {
  const snapshot = Object.freeze({
    os: value.os,
    shell: value.shell,
    pathStyle: value.pathStyle,
    lineEnding: value.lineEnding,
    caseSensitive: value.caseSensitive,
    workspaceKind: value.workspaceKind,
  });
  assertPlatformRuntimeProfileSupported(snapshot);
  return snapshot;
}

function requireSurface(value: AgentSurfaceKind): AgentSurfaceKind {
  if (!['vscode', 'cli', 'jsonl', 'headless', 'desktop', 'test'].includes(value)) {
    commandFailure('invalid-surface');
  }
  return value;
}

function optionalText<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return value === undefined ? {} : { [key]: requireText(value, `invalid-${key}`) } as Record<K, string>;
}

function optionalTextArray<K extends string>(key: K, value: unknown): Partial<Record<K, string[]>> {
  if (value === undefined) return {};
  if (!Array.isArray(value)) commandFailure(`invalid-${key}`);
  const snapshot = Object.freeze(value.map(item => requireText(item, `invalid-${key}-item`)));
  return { [key]: snapshot } as unknown as Record<K, string[]>;
}

function optionalBoolean<K extends string>(key: K, value: unknown): Partial<Record<K, boolean>> {
  if (value === undefined) return {};
  if (typeof value !== 'boolean') commandFailure(`invalid-${key}`);
  return { [key]: value } as Record<K, boolean>;
}

function optionalPositiveNumber<K extends string>(key: K, value: unknown): Partial<Record<K, number>> {
  if (value === undefined) return {};
  if (!Number.isFinite(value) || Number(value) <= 0) commandFailure(`invalid-${key}`);
  return { [key]: value } as Record<K, number>;
}

function optionalFunction<K extends string, T>(key: K, value: T | undefined): Partial<Record<K, T>> {
  if (value === undefined) return {};
  if (typeof value !== 'function') commandFailure(`invalid-${key}`);
  return { [key]: value } as Record<K, T>;
}

function optionalEnum<K extends string, T extends string>(
  key: K,
  value: unknown,
  allowed: readonly T[],
): Partial<Record<K, T>> {
  return value === undefined ? {} : { [key]: requireEnum(value, allowed, `invalid-${key}`) } as Record<K, T>;
}

function requirePrimitiveText(value: unknown, reason: string): string {
  if (typeof value !== 'string') commandFailure(reason);
  return value;
}

function requireText(value: unknown, reason: string): string {
  const text = requirePrimitiveText(value, reason).trim();
  if (!text) commandFailure(reason);
  return text;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], reason: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) commandFailure(reason);
  return value as T;
}

function commandFailure(reason: string): never {
  throw new Error(`agent-command:${reason}`);
}
