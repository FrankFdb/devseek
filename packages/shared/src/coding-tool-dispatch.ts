import type { CodingToolEffect } from './coding-conformance';
import { classifyCodingTerminalEffects } from './coding-terminal-effects';
import { decideTerminalCommandPermission } from './coding-terminal-command-policy';
import type { CodingToolPurpose, CodingToolRisk } from './coding-tool-authority';
import {
  CanonicalToolSchemaRegistry,
  isFileWriteToolName,
  normalizeCodingFileWriteInputs,
  type CodingToolDescriptor,
  type CodingToolKind,
  type ToolSchemaRegistryPort,
} from './coding-tool-schema';

export const CODING_TOOL_DISPATCH_VERSION = 'devseek.coding-tool-dispatch/v1' as const;

export type CodingToolCallSource =
  | 'text-protocol'
  | 'provider-native-text'
  | 'fake-tool'
  | 'native'
  | 'surface'
  | 'internal';
export type CodingToolDispatchRejectionReason =
  | 'malformed-tool-arguments'
  | 'partial-tool-call'
  | 'unknown-tool'
  | 'invalid-tool-input';

export interface CodingRawToolCall {
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly arguments?: Record<string, unknown> | string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: Record<string, unknown> | string;
  };
}

export interface CodingToolDispatchContext {
  readonly source?: CodingToolCallSource;
  readonly workspaceRoot?: string;
}

export interface CodingToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly source: CodingToolCallSource;
  readonly registered: boolean;
  readonly kind: CodingToolKind;
  readonly risk: CodingToolRisk;
  readonly purpose: CodingToolPurpose;
  readonly effects: readonly CodingToolEffect[];
  readonly protectedPath: boolean;
  readonly targetPaths: readonly string[];
  readonly descriptor?: CodingToolDescriptor;
  readonly executable: boolean;
  readonly rejectionReason?: CodingToolDispatchRejectionReason;
  readonly missingFields?: readonly string[];
}

export interface RejectedCodingToolCallResult {
  readonly ok: false;
  readonly toolName: string;
  readonly error: CodingToolDispatchRejectionReason;
  readonly missingFields: readonly string[];
  readonly evidence: readonly [];
}

export interface CodingToolDispatchEnvelope {
  readonly version: typeof CODING_TOOL_DISPATCH_VERSION;
  readonly decision: 'accepted' | 'rejected';
  readonly source: CodingToolCallSource;
  readonly call: CodingToolCall;
  readonly reason?: CodingToolDispatchRejectionReason;
  readonly result?: RejectedCodingToolCallResult;
}

export interface ToolDispatchPort {
  dispatch(raw: CodingRawToolCall, context?: CodingToolDispatchContext): CodingToolDispatchEnvelope;
}

export class CanonicalToolDispatchService implements ToolDispatchPort {
  constructor(private readonly schemas: ToolSchemaRegistryPort = new CanonicalToolSchemaRegistry()) {}

  dispatch(raw: CodingRawToolCall, context: CodingToolDispatchContext = {}): CodingToolDispatchEnvelope {
    const source = context.source ?? inferSource(raw);
    const fn = isRecord(raw.function) ? raw.function : undefined;
    const name = this.schemas.canonicalName(String(fn?.name ?? raw.name ?? '').trim());
    const parsedInput = normalizeRawInput(raw.input ?? raw.arguments ?? fn?.arguments);
    const input = this.schemas.normalizeInput(name, parsedInput.input);
    const descriptor = this.schemas.resolve(name);
    const validation = descriptor
      ? this.schemas.validate(descriptor, input)
      : { valid: false, missingFields: [] as readonly string[] };
    const rejectionReason = getRejectionReason(name, descriptor, parsedInput.malformed, validation.valid);
    const operation = descriptor && !rejectionReason
      ? projectOperation(descriptor, input, context.workspaceRoot)
      : undefined;
    const targetPaths = descriptor ? projectTargetPaths(descriptor, input) : [];
    const call: CodingToolCall = Object.freeze({
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${source}:${name || 'unknown'}`,
      name,
      input,
      source,
      registered: Boolean(descriptor),
      kind: descriptor?.kind ?? 'plan',
      risk: operation?.risk ?? descriptor?.risk ?? 'high',
      purpose: operation?.purpose ?? descriptor?.purpose ?? 'observe',
      effects: Object.freeze([...(operation?.effects ?? descriptor?.effects ?? [])]),
      protectedPath: targetPaths.some(isProtectedWorkspacePath),
      targetPaths: Object.freeze(targetPaths),
      ...(descriptor ? { descriptor } : {}),
      executable: !rejectionReason,
      ...(rejectionReason ? { rejectionReason } : {}),
      ...(!validation.valid && validation.missingFields.length > 0
        ? { missingFields: Object.freeze([...validation.missingFields]) }
        : {}),
    });

    if (!rejectionReason) {
      return Object.freeze({
        version: CODING_TOOL_DISPATCH_VERSION,
        decision: 'accepted',
        source,
        call,
      });
    }
    return Object.freeze({
      version: CODING_TOOL_DISPATCH_VERSION,
      decision: 'rejected',
      source,
      call,
      reason: rejectionReason,
      result: codingToolCallToRejectedResult(call),
    });
  }
}

export function codingToolCallToRejectedResult(call: CodingToolCall): RejectedCodingToolCallResult {
  return Object.freeze({
    ok: false,
    toolName: call.name || 'unknown',
    error: call.rejectionReason ?? 'unknown-tool',
    missingFields: Object.freeze([...(call.missingFields ?? [])]),
    evidence: Object.freeze([]) as readonly [],
  });
}

function projectOperation(
  descriptor: CodingToolDescriptor,
  input: Readonly<Record<string, unknown>>,
  workspaceRoot?: string,
): { readonly risk: CodingToolRisk; readonly purpose: CodingToolPurpose; readonly effects: readonly CodingToolEffect[] } {
  if (descriptor.kind !== 'terminal') {
    return { risk: descriptor.risk, purpose: descriptor.purpose, effects: descriptor.effects };
  }
  const command = stringField(input, 'command');
  const workdir = stringField(input, 'workdir');
  const terminal = decideTerminalCommandPermission({
    command,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(workdir ? { workdir } : {}),
  });
  const effects = projectTerminalEffects(command, terminal.risk);
  const purpose = effects.includes('network') || effects.includes('workspace-mutation')
    ? 'external-effect'
    : terminal.risk === 'read-only'
      ? 'observe'
      : 'verify';
  return Object.freeze({
    risk: projectTerminalRisk(terminal.risk),
    purpose,
    effects: Object.freeze(effects),
  });
}

function projectTerminalEffects(
  command: string,
  risk: ReturnType<typeof decideTerminalCommandPermission>['risk'],
): CodingToolEffect[] {
  const effects = classifyCodingTerminalEffects(command);
  if ((risk === 'mutating' || risk === 'destructive' || risk === 'unknown')
    && !effects.includes('workspace-mutation')) {
    effects.push('workspace-mutation');
  }
  return effects;
}

function projectTerminalRisk(risk: ReturnType<typeof decideTerminalCommandPermission>['risk']): CodingToolRisk {
  if (risk === 'destructive') return 'destructive';
  if (risk === 'mutating' || risk === 'unknown') return 'high';
  return risk === 'validation' ? 'medium' : 'low';
}

function projectTargetPaths(
  descriptor: CodingToolDescriptor,
  input: Readonly<Record<string, unknown>>,
): string[] {
  if (isFileWriteToolName(descriptor.name)) {
    return uniqueStrings(normalizeCodingFileWriteInputs(input).map(item => item.rawPath));
  }
  if (descriptor.name === 'apply_workspace_artifacts') {
    return projectWorkspaceArtifactPaths(input.proposal);
  }
  return uniqueStrings([
    stringField(input, 'path', 'filePath', 'targetPath'),
    ...(Array.isArray(input.paths) ? input.paths.filter(value => typeof value === 'string') as string[] : []),
  ]);
}

function projectWorkspaceArtifactPaths(proposal: unknown): string[] {
  if (!isRecord(proposal)) return [];
  return uniqueStrings([
    ...projectRecordArrayField(proposal.fileToolCalls, 'filePath'),
    ...projectRecordArrayField(proposal.unifiedDiffs, 'filePath'),
  ]);
}

function projectRecordArrayField(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!isRecord(entry)) return [];
    const candidate = entry[field];
    return typeof candidate === 'string' ? [candidate] : [];
  });
}

function getRejectionReason(
  name: string,
  descriptor: CodingToolDescriptor | undefined,
  malformedInput: boolean,
  validInput: boolean,
): CodingToolDispatchRejectionReason | undefined {
  if (!name) return 'partial-tool-call';
  if (malformedInput) return 'malformed-tool-arguments';
  if (!descriptor) return 'unknown-tool';
  if (!validInput) return 'invalid-tool-input';
  return undefined;
}

function normalizeRawInput(value: unknown): { input: Record<string, unknown>; malformed: boolean } {
  if (isRecord(value)) return { input: value, malformed: false };
  if (value === undefined) return { input: {}, malformed: false };
  if (typeof value !== 'string') return { input: {}, malformed: true };
  const normalized = value.trim();
  if (!normalized) return { input: {}, malformed: false };
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return isRecord(parsed)
      ? { input: parsed, malformed: false }
      : { input: {}, malformed: true };
  } catch {
    return { input: {}, malformed: true };
  }
}

function inferSource(raw: CodingRawToolCall): CodingToolCallSource {
  return isRecord(raw.input) && typeof raw.name === 'string' ? 'fake-tool' : 'native';
}

function isProtectedWorkspacePath(value: string): boolean {
  const segments = value.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.some(segment => segment === '.git'
    || segment === '.ssh'
    || segment === '.env'
    || segment.startsWith('.env.'));
}

function stringField(input: Readonly<Record<string, unknown>>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
