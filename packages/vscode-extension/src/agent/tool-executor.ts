import {
  CanonicalToolDispatchService,
  buildCodingToolAction,
  codingToolCallToRejectedResult,
  getCodingToolDescriptor,
  isFileWriteToolName,
  type CodingToolAuthorityReceipt,
  type CodingToolAuthoritySessionPort,
  type CodingToolCall,
  type CodingToolDescriptor,
  type CodingToolExecutionOutcome,
  type CodingToolHostResult,
  type CodingToolEffect,
  type CodingToolKind,
  type CodingToolPurpose,
  type ToolDispatchPort,
  type ToolExecutorPort,
} from '@devseek-netai/shared';
import type { ToolPolicy, ToolPermissionDecision } from '../app/permission-service';
import { decideToolPermission } from '../app/permission-service';
import type { FakeTool } from './fake-tool-parser';
import { getAgentToolActivity, type AgentToolActivity } from './tool-activity';
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
  kind: CodingToolKind;
  risk: CodingToolCall['risk'];
  registered: boolean;
  activity: AgentToolActivity | null;
  call: CodingToolCall;
  descriptor?: CodingToolDescriptor;
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
  constructor(
    private readonly canonicalExecutor: ToolExecutorPort,
    private readonly dispatch: ToolDispatchPort = new CanonicalToolDispatchService(),
  ) {}

  plan(tool: FakeTool | CodingToolCall, policy?: ToolPolicy, workspaceRoot?: string): AgentToolExecutionPlan {
    const call = isDispatchedToolCall(tool)
      ? tool
      : this.dispatch.dispatch(tool, { source: 'fake-tool', ...(workspaceRoot ? { workspaceRoot } : {}) }).call;
    const descriptor = call.descriptor;
    const normalizedTool = { name: call.name, input: { ...call.input } };
    const permission = call.rejectionReason
      ? { action: 'deny' as const, reason: `tool-call-rejected:${call.rejectionReason}` }
      : descriptor
      ? policy
        ? decideToolPermission(policy, {
          kind: call.kind,
          toolName: call.name,
          risk: call.risk,
          mutatesWorkspace: descriptor.mutatesWorkspace,
          protectedPath: call.protectedPath,
        })
        : undefined
      : { action: 'deny' as const, reason: `tool-not-registered:${call.name || 'unknown'}` };

    return {
      tool: normalizedTool,
      kind: call.kind,
      risk: call.risk,
      registered: Boolean(descriptor),
      activity: getAgentToolActivity(normalizedTool),
      call,
      descriptor,
      effects: call.effects,
      purpose: call.purpose,
      protectedPath: call.protectedPath,
      plannedRefs: buildPlannedRefs(call),
      permission,
    };
  }

  isFileWrite(tool: FakeTool): boolean {
    return isFileWriteToolName(tool.name);
  }

  validateInput(plan: AgentToolExecutionPlan): ToolInputValidationResult {
    if (plan.call.rejectionReason) {
      const missing = plan.call.missingFields?.length
        ? `，缺少必填参数: ${plan.call.missingFields.join(', ')}`
        : '';
      return { ok: false, error: `工具调用已拒绝: ${plan.call.rejectionReason}${missing}` };
    }
    if (!plan.registered || !plan.descriptor) {
      return { ok: false, error: `未注册工具: ${plan.call.name || 'unknown'}` };
    }
    return { ok: true };
  }

  toResult(plan: AgentToolExecutionPlan, result: ToolResultInput = {}): ToolResult {
    if (plan.call.rejectionReason) {
      const rejected = codingToolCallToRejectedResult(plan.call);
      return {
        ...rejected,
        evidence: [...rejected.evidence],
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

export function classifyToolKind(name: string): CodingToolKind {
  return getCodingToolDescriptor(name)?.kind ?? 'plan';
}

function buildPlannedRefs(call: CodingToolCall): EvidenceRef[] {
  const input = call.input;
  const activity = getAgentToolActivity(call);
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

function isDispatchedToolCall(tool: FakeTool | CodingToolCall): tool is CodingToolCall {
  return 'registered' in tool && 'source' in tool && 'risk' in tool;
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
