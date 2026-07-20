import type { ToolKind, ToolRisk } from '../intent/intent-types';
import type { FakeTool } from './fake-tool-parser';
import type { AgentToolDefinition } from './tool-registry';
import { getToolDefinition, normalizeAgentToolInput, normalizeAgentToolName } from './tool-registry';

export type ToolCallSource = 'fake-tool' | 'native';
export const TOOL_CALL_NORMALIZATION_PROTOCOL_VERSION = 'devseek.tool-call-normalization/v1';

export type ToolCallRejectionReason =
  | 'malformed-tool-arguments'
  | 'partial-tool-call'
  | 'unknown-tool';

export interface RejectedToolCallResult {
  ok: false;
  toolName: string;
  error: ToolCallRejectionReason;
  evidence: [];
}

export interface ToolCallNormalizationEnvelope {
  version: typeof TOOL_CALL_NORMALIZATION_PROTOCOL_VERSION;
  decision: 'accepted' | 'rejected';
  source: ToolCallSource;
  call: ToolCall;
  reason?: ToolCallRejectionReason;
  result?: RejectedToolCallResult;
}

export interface NativeToolCall {
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  arguments?: Record<string, unknown> | string;
  function?: {
    name?: string;
    arguments?: Record<string, unknown> | string;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  source: ToolCallSource;
  registered: boolean;
  kind: ToolKind;
  risk: ToolRisk;
  definition?: AgentToolDefinition;
  executable: boolean;
  rejectionReason?: ToolCallRejectionReason;
}

export function normalizeToolCall(raw: FakeTool | NativeToolCall, source?: ToolCallSource): ToolCall {
  return normalizeToolCallEnvelope(raw, source).call;
}

export function normalizeToolCallEnvelope(raw: FakeTool | NativeToolCall, source?: ToolCallSource): ToolCallNormalizationEnvelope {
  const candidate = raw as NativeToolCall;
  const callSource = source ?? inferSource(raw);
  const fn = isRecord(candidate.function) ? candidate.function : undefined;
  const name = normalizeAgentToolName(String(fn?.name ?? candidate.name ?? '').trim());
  const parsedInput = normalizeInput(candidate.input ?? candidate.arguments ?? fn?.arguments);
  const input = normalizeAgentToolInput(name, parsedInput.input);
  const definition = getToolDefinition(name);
  const rejectionReason = getRejectionReason(name, definition, parsedInput.malformed);

  const call: ToolCall = {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `${callSource}:${name || 'unknown'}`,
    name,
    input,
    source: callSource,
    registered: Boolean(definition),
    kind: definition?.kind ?? 'plan',
    risk: definition?.risk ?? 'high',
    definition,
    executable: !rejectionReason,
  };
  if (rejectionReason) call.rejectionReason = rejectionReason;

  if (rejectionReason) {
    return {
      version: TOOL_CALL_NORMALIZATION_PROTOCOL_VERSION,
      decision: 'rejected',
      source: callSource,
      call,
      reason: rejectionReason,
      result: toolCallToRejectedResult(call),
    };
  }

  return {
    version: TOOL_CALL_NORMALIZATION_PROTOCOL_VERSION,
    decision: 'accepted',
    source: callSource,
    call,
  };
}

export function toolCallToFakeTool(call: ToolCall): FakeTool {
  return {
    name: call.name,
    input: call.input,
  };
}

export function toolCallToRejectedResult(call: ToolCall): RejectedToolCallResult {
  return {
    ok: false,
    toolName: call.name || 'unknown',
    error: call.rejectionReason ?? 'unknown-tool',
    evidence: [],
  };
}

function inferSource(raw: FakeTool | NativeToolCall): ToolCallSource {
  return isRecord(raw.input) && typeof raw.name === 'string' ? 'fake-tool' : 'native';
}

function getRejectionReason(
  name: string,
  definition: AgentToolDefinition | undefined,
  malformedInput: boolean,
): ToolCallRejectionReason | undefined {
  if (!name) return 'partial-tool-call';
  if (malformedInput) return 'malformed-tool-arguments';
  if (!definition) return 'unknown-tool';
  return undefined;
}

function normalizeInput(value: unknown): { input: Record<string, unknown>; malformed: boolean } {
  if (isRecord(value)) return { input: value, malformed: false };
  if (typeof value !== 'string') return { input: {}, malformed: false };
  const trimmed = value.trim();
  if (!trimmed) return { input: {}, malformed: false };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed)
      ? { input: parsed, malformed: false }
      : { input: {}, malformed: true };
  } catch {
    return { input: {}, malformed: true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
