import {
  CanonicalToolExecutor,
  buildCodingToolAction,
  classifyCodingTerminalEffects,
  type CodingToolAuthorityReceipt,
  type CodingToolAuthoritySessionPort,
  type CodingToolExecutionOutcome,
  type CodingToolHostResult,
  type CodingToolEffect,
  type CodingToolPurpose,
  type ToolExecutorPort,
} from '@devseek-netai/shared';
import type { ToolPolicy, ToolPermissionDecision } from '../app/permission-service';
import { decideToolPermission } from '../app/permission-service';
import { decideTerminalCommandPermission } from '../app/terminal-command-policy';
import type { ToolKind } from '../intent/intent-types';
import type { FakeTool } from './fake-tool-parser';
import type { ToolCall } from './tool-call-normalizer';
import { normalizeToolCall, toolCallToFakeTool, toolCallToRejectedResult } from './tool-call-normalizer';
import {
  type AgentToolDefinition,
  type AgentToolActivity,
  getToolDefinition,
  getToolActivity,
  hasCompleteAgentFileWriteBatch,
  isFileWriteTool,
} from './tool-registry';
import type { EvidenceRef } from './evidence-grounding';
export type { EvidenceRef } from './evidence-grounding';

export interface ToolResult {
  ok: boolean;
  toolName: string;
  output?: string;
  error?: string;
  evidence: EvidenceRef[];
  permission?: ToolPermissionDecision;
}

export interface ToolResultInput {
  ok?: boolean;
  output?: string;
  error?: string;
  evidence?: EvidenceRef[];
}

export interface AgentToolExecutionPlan {
  tool: FakeTool;
  kind: ToolKind;
  risk: ToolCall['risk'];
  registered: boolean;
  activity: AgentToolActivity | null;
  call: ToolCall;
  definition?: AgentToolDefinition;
  effects: readonly CodingToolEffect[];
  purpose: CodingToolPurpose;
  protectedPath: boolean;
  /** Display/audit intent only. These are not execution evidence and never enter EvidenceStore. */
  plannedRefs: EvidenceRef[];
  permission?: ToolPermissionDecision;
}

export interface ToolInputValidationResult {
  ok: boolean;
  error?: string;
}

export interface AgentToolCanonicalExecutionInput<TResult> {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly authority: CodingToolAuthorityReceipt;
  readonly authoritySession: CodingToolAuthoritySessionPort;
  readonly host: {
    execute(
      plan: AgentToolExecutionPlan,
      authority: CodingToolAuthorityReceipt,
    ): Promise<CodingToolHostResult<TResult>>;
  };
}

export class AgentToolExecutor {
  constructor(private readonly canonicalExecutor: ToolExecutorPort = new CanonicalToolExecutor()) {}

  plan(tool: FakeTool | ToolCall, policy?: ToolPolicy): AgentToolExecutionPlan {
    const call = isNormalizedToolCall(tool) ? tool : normalizeToolCall(tool, 'fake-tool');
    const definition = call.definition ?? getToolDefinition(call.name);
    const normalizedTool = toolCallToFakeTool(call);
    const risk = projectToolRisk(call, definition);
    const permission = call.rejectionReason
      ? { action: 'deny' as const, reason: `tool-call-rejected:${call.rejectionReason}` }
      : definition
      ? policy
        ? decideToolPermission(policy, {
          kind: call.kind,
          toolName: call.name,
          risk,
          mutatesWorkspace: definition.mutatesWorkspace,
          protectedPath: hasProtectedWorkspacePath(call.input),
        })
        : undefined
      : { action: 'deny' as const, reason: `tool-not-registered:${call.name || 'unknown'}` };

    const effects = projectToolEffects({ call, definition });
    return {
      tool: normalizedTool,
      kind: call.kind,
      risk,
      registered: Boolean(definition),
      activity: getToolActivity(normalizedTool),
      call,
      definition,
      effects,
      purpose: projectToolPurpose(call, definition),
      protectedPath: hasProtectedWorkspacePath(call.input),
      plannedRefs: buildPlannedRefs(call),
      permission,
    };
  }

  isFileWrite(tool: FakeTool): boolean {
    return isFileWriteTool(tool.name);
  }

  validateInput(plan: AgentToolExecutionPlan): ToolInputValidationResult {
    if (plan.call.rejectionReason) {
      return { ok: false, error: `工具调用已拒绝: ${plan.call.rejectionReason}` };
    }
    if (!plan.registered || !plan.definition) {
      return { ok: false, error: `未注册工具: ${plan.call.name || 'unknown'}` };
    }
    if (isFileWriteTool(plan.tool.name) && hasCompleteAgentFileWriteBatch(plan.call.input)) {
      return { ok: true };
    }
    const missing = missingRequiredFields(plan.definition, plan.call.input);
    if (missing.length > 0) {
      return { ok: false, error: `缺少必填参数: ${missing.join(', ')}` };
    }
    return { ok: true };
  }

  toResult(plan: AgentToolExecutionPlan, result: ToolResultInput = {}): ToolResult {
    if (plan.call.rejectionReason) {
      return {
        ...toolCallToRejectedResult(plan.call),
        permission: plan.permission,
      };
    }
    const ok = result.ok ?? !result.error;
    return {
      ok,
      toolName: plan.tool.name,
      output: result.output,
      error: result.error,
      evidence: ok ? [...(result.evidence ?? [])] : [],
      permission: plan.permission,
    };
  }

  executeCanonical<TResult>(
    plan: AgentToolExecutionPlan,
    input: AgentToolCanonicalExecutionInput<TResult>,
  ): Promise<CodingToolExecutionOutcome<TResult>> {
    const action = buildCodingToolAction({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: plan.tool.name,
      purpose: plan.purpose,
      effects: plan.effects,
      input: plan.call.input,
      authority: input.authority,
    });
    return this.canonicalExecutor.execute(action, {
      execute: () => input.host.execute(plan, input.authority),
    }, input.authoritySession);
  }
}

function missingRequiredFields(definition: AgentToolDefinition, input: Record<string, unknown>): string[] {
  const required = definition.schema.required ?? [];
  return required.filter((key) => !hasSchemaValue(input[key], definition.schema.properties[key]?.type));
}

function hasSchemaValue(value: unknown, expectedType?: AgentToolDefinition['schema']['properties'][string]['type']): boolean {
  if (value === undefined || value === null) return false;
  if (!expectedType) return true;
  if (expectedType === 'string') return typeof value === 'string' && value.trim().length > 0;
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return typeof value === 'object' && !Array.isArray(value);
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expectedType === 'boolean') return typeof value === 'boolean';
  return true;
}

export function classifyToolKind(name: string): ToolKind {
  return getToolDefinition(name)?.kind ?? 'plan';
}

export function projectToolEffects(
  plan: Pick<AgentToolExecutionPlan, 'call' | 'definition'>,
): readonly CodingToolEffect[] {
  if (plan.definition?.mutatesWorkspace) return ['workspace-mutation'];
  switch (plan.call.kind) {
    case 'terminal': {
      const command = stringField(plan.call.input, 'command', 'cmd');
      return classifyCodingTerminalEffects(command);
    }
    case 'vscode':
    case 'vscode-command':
      return ['process'];
    case 'network':
    case 'mcp':
      return ['network'];
    default:
      return ['read'];
  }
}

function projectToolPurpose(
  call: ToolCall,
  definition: AgentToolDefinition | undefined,
): CodingToolPurpose {
  if (definition?.mutatesWorkspace) return 'workspace-mutation';
  if (call.kind === 'network') return 'observe';
  if (call.kind === 'terminal') return 'verify';
  if (call.kind === 'mcp' || call.kind === 'vscode' || call.kind === 'vscode-command') {
    return 'external-effect';
  }
  return 'observe';
}

function projectToolRisk(
  call: ToolCall,
  definition: AgentToolDefinition | undefined,
): ToolCall['risk'] {
  if (call.kind !== 'terminal' || definition?.name !== 'run_terminal') return call.risk;
  const command = stringField(call.input, 'command', 'cmd');
  const risk = decideTerminalCommandPermission({ command }).risk;
  if (risk === 'destructive') return 'destructive';
  if (risk === 'mutating' || risk === 'unknown') return 'high';
  return risk === 'validation' ? 'medium' : 'low';
}

function buildPlannedRefs(call: ToolCall): EvidenceRef[] {
  const input = call.input;
  const activity = getToolActivity(toolCallToFakeTool(call));
  const label = activity?.label || stringField(input, 'path', 'filePath', 'query', 'pattern', 'url', 'command') || call.name;

  switch (call.kind) {
    case 'control':
      return [{ kind: 'plan', label }];
    case 'terminal':
      return [{ kind: 'terminal', label: stringField(input, 'command', 'cmd') || call.name }];
    case 'network':
      return [{ kind: 'network', label: stringField(input, 'url') || call.name }];
    case 'edit':
    case 'read':
      return [{ kind: call.kind, label }];
    case 'search':
      return [{ kind: 'search', label }];
    case 'diagnostics':
      return [{ kind: 'diagnostics', label: 'workspace diagnostics' }];
    case 'memory':
      return [{ kind: 'memory', label: preview(stringField(input, 'content', 'text') || call.name) }];
    case 'vscode':
    case 'vscode-command':
      return [{ kind: call.kind, label: stringField(input, 'command') || call.name }];
    case 'mcp':
      return [{ kind: 'mcp', label: call.name }];
    case 'plan':
      return [{ kind: 'plan', label: call.name }];
  }
}

function isNormalizedToolCall(tool: FakeTool | ToolCall): tool is ToolCall {
  return 'registered' in tool && 'source' in tool && 'risk' in tool;
}

function hasProtectedWorkspacePath(input: Record<string, unknown>): boolean {
  const value = stringField(input, 'path', 'filePath', 'targetPath');
  if (!value) return false;
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized === '.git'
    || normalized.startsWith('.git/')
    || normalized === '.env'
    || normalized.startsWith('.env.')
    || normalized.startsWith('.ssh/')
    || normalized.includes('/.git/');
}

function stringField(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function preview(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}
