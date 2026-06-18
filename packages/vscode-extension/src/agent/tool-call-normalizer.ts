import type { ToolKind, ToolRisk } from '../intent/intent-types';
import type { FakeTool } from './fake-tool-parser';
import type { AgentToolDefinition } from './tool-registry';
import { getToolDefinition } from './tool-registry';

export type ToolCallSource = 'fake-tool' | 'native';

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
}

export function normalizeToolCall(raw: FakeTool | NativeToolCall, source?: ToolCallSource): ToolCall {
  const candidate = raw as NativeToolCall;
  const callSource = source ?? inferSource(raw);
  const fn = isRecord(candidate.function) ? candidate.function : undefined;
  const name = String(fn?.name ?? candidate.name ?? '').trim();
  const input = normalizeInput(candidate.input ?? candidate.arguments ?? fn?.arguments);
  const definition = getToolDefinition(name);

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `${callSource}:${name || 'unknown'}`,
    name,
    input,
    source: callSource,
    registered: Boolean(definition),
    kind: definition?.kind ?? 'plan',
    risk: definition?.risk ?? 'high',
    definition,
  };
}

export function toolCallToFakeTool(call: ToolCall): FakeTool {
  return {
    name: call.name,
    input: call.input,
  };
}

function inferSource(raw: FakeTool | NativeToolCall): ToolCallSource {
  return isRecord(raw.input) && typeof raw.name === 'string' ? 'fake-tool' : 'native';
}

function normalizeInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
