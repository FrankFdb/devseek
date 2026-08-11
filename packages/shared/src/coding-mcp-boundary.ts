import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import { codingSemanticDigest } from './coding-semantic-digest';

export const CODING_MCP_SERVER_LAUNCH_REQUEST_VERSION =
  'devseek.coding-mcp-server-launch-request/v1' as const;
export const CODING_MCP_SERVER_LAUNCH_RECEIPT_VERSION =
  'devseek.coding-mcp-server-launch-receipt/v1' as const;
export const CODING_MCP_TOOL_CALL_REQUEST_VERSION =
  'devseek.coding-mcp-tool-call-request/v1' as const;
export const CODING_MCP_TOOL_CALL_RECEIPT_VERSION =
  'devseek.coding-mcp-tool-call-receipt/v1' as const;

const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MCP_ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_MCP_ARGUMENTS = 128;
const MAX_MCP_TOOLS_PER_SERVER = 512;
const MAX_MCP_ENVIRONMENT_KEYS = 256;
const MAX_MCP_SERVER_CONFIGURATION_CHARS = 1_048_576;
const MAX_MCP_TOOL_SCHEMA_CHARS = 262_144;
const MAX_MCP_TOOL_ARGUMENT_CHARS = 1_048_576;

export type CodingMcpAuthorityDecision = 'allow' | 'deny';
export type CodingMcpAuthorityActor = 'user' | 'host-policy';
export type CodingMcpToolRisk = 'medium' | 'high' | 'destructive';

export interface CodingMcpServerLaunchCandidate {
  readonly serverName: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface CodingMcpServerConfiguration {
  readonly serverName: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

export interface CodingMcpServerLaunchRequest {
  readonly version: typeof CODING_MCP_SERVER_LAUNCH_REQUEST_VERSION;
  readonly serverName: string;
  readonly commandLabel: string;
  readonly argumentCount: number;
  readonly environmentKeys: readonly string[];
  readonly configurationSha256: string;
  readonly requestSha256: string;
}

export interface CodingMcpPreparedServerLaunch {
  readonly configuration: CodingMcpServerConfiguration;
  readonly request: CodingMcpServerLaunchRequest;
}

export interface CodingMcpAuthorityApproval {
  readonly decision: CodingMcpAuthorityDecision;
  readonly actor: CodingMcpAuthorityActor;
  readonly reason: string;
  readonly evidenceRef?: string;
}

export interface CodingMcpServerLaunchReceipt {
  readonly version: typeof CODING_MCP_SERVER_LAUNCH_RECEIPT_VERSION;
  readonly serverName: string;
  readonly requestSha256: string;
  readonly configurationSha256: string;
  readonly decision: CodingMcpAuthorityDecision;
  readonly actor: CodingMcpAuthorityActor;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingMcpToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

export interface CodingMcpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations?: CodingMcpToolAnnotations;
}

export interface CodingMcpToolRef {
  readonly serverName: string;
  readonly toolName: string;
  readonly fakeName: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: CodingMcpToolAnnotations;
  readonly risk: CodingMcpToolRisk;
  readonly registrationSha256: string;
}

export interface CodingMcpToolCallRequest {
  readonly version: typeof CODING_MCP_TOOL_CALL_REQUEST_VERSION;
  readonly callId: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly fakeName: string;
  readonly risk: CodingMcpToolRisk;
  readonly argumentsSha256: string;
  readonly registrationSha256: string;
  readonly requiresUserConfirmation: boolean;
  readonly requestSha256: string;
}

export interface CodingMcpToolCallReceipt {
  readonly version: typeof CODING_MCP_TOOL_CALL_RECEIPT_VERSION;
  readonly callId: string;
  readonly requestSha256: string;
  readonly registrationSha256: string;
  readonly decision: CodingMcpAuthorityDecision;
  readonly actor: CodingMcpAuthorityActor;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingMcpVerifiedToolCall {
  readonly serverName: string;
  readonly toolName: string;
  readonly fakeName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface CodingMcpBoundarySessionPort {
  prepareServerLaunch(candidate: CodingMcpServerLaunchCandidate): CodingMcpPreparedServerLaunch;
  authorizeServerLaunch(
    request: CodingMcpServerLaunchRequest,
    approval: CodingMcpAuthorityApproval,
  ): CodingMcpServerLaunchReceipt;
  verifyServerLaunch(
    prepared: CodingMcpPreparedServerLaunch,
    receipt: CodingMcpServerLaunchReceipt,
  ): CodingMcpServerConfiguration;
  registerTools(input: {
    readonly prepared: CodingMcpPreparedServerLaunch;
    readonly receipt: CodingMcpServerLaunchReceipt;
    readonly tools: readonly CodingMcpToolDescriptor[];
  }): readonly CodingMcpToolRef[];
  prepareToolCall(
    fakeName: string,
    args: Readonly<Record<string, unknown>>,
  ): CodingMcpToolCallRequest;
  authorizeToolCall(
    request: CodingMcpToolCallRequest,
    approval: CodingMcpAuthorityApproval,
  ): CodingMcpToolCallReceipt;
  verifyToolCall(
    request: CodingMcpToolCallRequest,
    receipt: CodingMcpToolCallReceipt,
  ): CodingMcpVerifiedToolCall;
  toolRefs(): readonly CodingMcpToolRef[];
  launchReceipts(): readonly CodingMcpServerLaunchReceipt[];
  callReceipts(): readonly CodingMcpToolCallReceipt[];
}

interface PreparedLaunchState {
  readonly prepared: CodingMcpPreparedServerLaunch;
  receipt?: CodingMcpServerLaunchReceipt;
}

interface PendingToolCallState {
  readonly request: CodingMcpToolCallRequest;
  readonly tool: CodingMcpToolRef;
  readonly args: Readonly<Record<string, unknown>>;
  receipt?: CodingMcpToolCallReceipt;
  effectClaimed: boolean;
}

/**
 * Owns MCP launch and invocation authority. Tool annotations remain untrusted
 * risk hints, so every launch and every call requires explicit user evidence.
 */
export class CanonicalMcpBoundaryService {
  bind(input: { readonly workspaceRoot: string }): CodingMcpBoundarySessionPort {
    const workspaceRoot = normalizedCodingId(input.workspaceRoot, 'mcp-workspace-root');
    const launches = new Map<string, PreparedLaunchState>();
    const tools = new Map<string, CodingMcpToolRef>();
    const pendingCalls = new Map<string, PendingToolCallState>();
    const launchReceipts: CodingMcpServerLaunchReceipt[] = [];
    const callReceipts: CodingMcpToolCallReceipt[] = [];
    let callSequence = 0;

    let session: CodingMcpBoundarySessionPort;
    const mutableSession: CodingMcpBoundarySessionPort = {
      prepareServerLaunch: candidate => {
        const configuration = snapshotServerConfiguration(candidate, workspaceRoot);
        const configurationSha256 = codingSemanticDigest(configuration);
        const requestBase = {
          version: CODING_MCP_SERVER_LAUNCH_REQUEST_VERSION,
          serverName: configuration.serverName,
          commandLabel: commandLabel(configuration.command),
          argumentCount: configuration.args.length,
          environmentKeys: Object.freeze(Object.keys(configuration.env).sort()),
          configurationSha256,
        };
        const request = Object.freeze({
          ...requestBase,
          requestSha256: codingSemanticDigest(requestBase),
        });
        const existing = launches.get(request.requestSha256);
        if (existing) {
          if (canonicalCodingJson(existing.prepared.configuration) !== canonicalCodingJson(configuration)) {
            throw new Error('coding-mcp-boundary:conflicting-launch-request');
          }
          return existing.prepared;
        }
        const prepared = Object.freeze({ configuration, request });
        launches.set(request.requestSha256, { prepared });
        return prepared;
      },
      authorizeServerLaunch: (request, approval) => {
        const state = requirePreparedLaunch(launches, request);
        const normalizedApproval = normalizeApproval(approval, 'server-launch');
        const receipt = snapshotLaunchReceipt(request, normalizedApproval);
        if (state.receipt) {
          requireExactReceipt(state.receipt, receipt, 'conflicting-launch-authorization');
          return state.receipt;
        }
        state.receipt = receipt;
        launchReceipts.push(receipt);
        return receipt;
      },
      verifyServerLaunch: (prepared, receipt) => {
        const state = requirePreparedLaunch(launches, prepared.request);
        if (canonicalCodingJson(state.prepared.configuration)
          !== canonicalCodingJson(prepared.configuration)) {
          throw new Error('coding-mcp-boundary:launch-configuration-mismatch');
        }
        requireAuthorizedReceipt(state.receipt, receipt, 'server-launch');
        return state.prepared.configuration;
      },
      registerTools: registration => {
        const configuration = session.verifyServerLaunch(registration.prepared, registration.receipt);
        if (!Array.isArray(registration.tools) || registration.tools.length > MAX_MCP_TOOLS_PER_SERVER) {
          throw new Error('coding-mcp-boundary:invalid-tool-count');
        }
        const descriptors = registration.tools.map(snapshotToolDescriptor);
        const localAliases = new Set<string>();
        const additions = descriptors.map(tool => {
          const fakeName = mcpFakeToolName(configuration.serverName, tool.name);
          if (localAliases.has(fakeName) || tools.has(fakeName)) {
            throw new Error(`coding-mcp-boundary:duplicate-tool-alias:${fakeName}`);
          }
          localAliases.add(fakeName);
          const registrationSha256 = codingSemanticDigest({
            launchRequestSha256: registration.prepared.request.requestSha256,
            serverName: configuration.serverName,
            tool,
            fakeName,
          });
          return Object.freeze({
            serverName: configuration.serverName,
            toolName: tool.name,
            fakeName,
            description: tool.description ?? '',
            inputSchema: tool.inputSchema,
            annotations: tool.annotations ?? Object.freeze({}),
            risk: classifyMcpToolRisk(tool.annotations),
            registrationSha256,
          });
        });
        for (const addition of additions) tools.set(addition.fakeName, addition);
        return Object.freeze(additions);
      },
      prepareToolCall: (fakeName, args) => {
        const normalizedFakeName = normalizedCodingId(fakeName, 'mcp-fake-tool-name');
        const tool = tools.get(normalizedFakeName);
        if (!tool) throw new Error(`coding-mcp-boundary:unknown-tool:${normalizedFakeName}`);
        const snapshottedArgs = snapshotToolArguments(args);
        callSequence += 1;
        const requestBase = {
          version: CODING_MCP_TOOL_CALL_REQUEST_VERSION,
          callId: `mcp-call-${callSequence}`,
          serverName: tool.serverName,
          toolName: tool.toolName,
          fakeName: tool.fakeName,
          risk: tool.risk,
          argumentsSha256: codingSemanticDigest(snapshottedArgs),
          registrationSha256: tool.registrationSha256,
          requiresUserConfirmation: tool.risk !== 'medium',
        };
        const request = Object.freeze({
          ...requestBase,
          requestSha256: codingSemanticDigest(requestBase),
        });
        pendingCalls.set(request.requestSha256, {
          request,
          tool,
          args: snapshottedArgs,
          effectClaimed: false,
        });
        return request;
      },
      authorizeToolCall: (request, approval) => {
        const state = requirePendingToolCall(pendingCalls, request);
        const normalizedApproval = normalizeApproval(
          approval,
          'tool-call',
          state.request.requiresUserConfirmation,
        );
        const receipt = snapshotToolCallReceipt(request, normalizedApproval);
        if (state.receipt) {
          requireExactReceipt(state.receipt, receipt, 'conflicting-tool-authorization');
          return state.receipt;
        }
        state.receipt = receipt;
        callReceipts.push(receipt);
        return receipt;
      },
      verifyToolCall: (request, receipt) => {
        const state = requirePendingToolCall(pendingCalls, request);
        requireAuthorizedReceipt(state.receipt, receipt, 'tool-call');
        if (state.effectClaimed) {
          throw new Error('coding-mcp-boundary:tool-call-effect-already-claimed');
        }
        state.effectClaimed = true;
        return Object.freeze({
          serverName: state.tool.serverName,
          toolName: state.tool.toolName,
          fakeName: state.tool.fakeName,
          arguments: state.args,
        });
      },
      toolRefs: () => Object.freeze([...tools.values()]),
      launchReceipts: () => Object.freeze([...launchReceipts]),
      callReceipts: () => Object.freeze([...callReceipts]),
    };
    session = Object.freeze(mutableSession);
    return session;
  }
}

function snapshotServerConfiguration(
  candidate: CodingMcpServerLaunchCandidate,
  workspaceRoot: string,
): CodingMcpServerConfiguration {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('coding-mcp-boundary:invalid-server-configuration');
  }
  const serverName = normalizedCodingId(candidate.serverName, 'mcp-server-name');
  if (!MCP_SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error(`coding-mcp-boundary:invalid-server-name:${serverName}`);
  }
  const command = normalizedCodingId(candidate.command, 'mcp-server-command');
  if (command.includes('\0') || /[\r\n]/.test(command) || command.length > 4096) {
    throw new Error('coding-mcp-boundary:invalid-server-command');
  }
  if (candidate.args !== undefined && !Array.isArray(candidate.args)) {
    throw new Error('coding-mcp-boundary:invalid-server-arguments');
  }
  const args = Object.freeze([...(candidate.args ?? [])].map((value, index) => {
    if (typeof value !== 'string' || value.includes('\0') || value.length > 32_768) {
      throw new Error(`coding-mcp-boundary:invalid-server-argument:${index}`);
    }
    return value;
  }));
  if (args.length > MAX_MCP_ARGUMENTS) {
    throw new Error('coding-mcp-boundary:too-many-server-arguments');
  }
  const sourceEnv = candidate.env ?? {};
  if (!sourceEnv || typeof sourceEnv !== 'object' || Array.isArray(sourceEnv)) {
    throw new Error('coding-mcp-boundary:invalid-server-environment');
  }
  const environmentEntries = Object.entries(sourceEnv).sort(([left], [right]) => left.localeCompare(right));
  if (environmentEntries.length > MAX_MCP_ENVIRONMENT_KEYS) {
    throw new Error('coding-mcp-boundary:too-many-environment-keys');
  }
  const env = Object.freeze(Object.fromEntries(environmentEntries.map(([key, value]) => {
    if (!MCP_ENVIRONMENT_KEY_PATTERN.test(key)) {
      throw new Error(`coding-mcp-boundary:invalid-environment-key:${key}`);
    }
    if (typeof value !== 'string' || value.includes('\0') || value.length > 1_048_576) {
      throw new Error(`coding-mcp-boundary:invalid-environment-value:${key}`);
    }
    return [key, value];
  })));
  const configuration = Object.freeze({ serverName, command, args, env, cwd: workspaceRoot });
  assertMcpCanonicalSize(
    configuration,
    MAX_MCP_SERVER_CONFIGURATION_CHARS,
    'server-configuration',
  );
  return configuration;
}

function snapshotToolDescriptor(candidate: CodingMcpToolDescriptor): CodingMcpToolDescriptor {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('coding-mcp-boundary:invalid-tool-descriptor');
  }
  const name = normalizedCodingId(candidate.name, 'mcp-tool-name');
  if (!MCP_TOOL_NAME_PATTERN.test(name)) {
    throw new Error(`coding-mcp-boundary:invalid-tool-name:${name}`);
  }
  if (candidate.description !== undefined && typeof candidate.description !== 'string') {
    throw new Error(`coding-mcp-boundary:invalid-tool-description:${name}`);
  }
  const description = candidate.description?.trim();
  if (description && description.length > 16_384) {
    throw new Error(`coding-mcp-boundary:tool-description-too-large:${name}`);
  }
  const inputSchema = snapshotBoundedMcpValue(
    candidate.inputSchema,
    'tool-input-schema',
    { maxDepth: 32, maxNodes: 8_192, maxCanonicalChars: MAX_MCP_TOOL_SCHEMA_CHARS },
  );
  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    throw new Error(`coding-mcp-boundary:invalid-tool-input-schema:${name}`);
  }
  const annotations = snapshotToolAnnotations(candidate.annotations);
  return Object.freeze({
    name,
    ...(description ? { description } : {}),
    inputSchema: inputSchema as Readonly<Record<string, unknown>>,
    ...(annotations ? { annotations } : {}),
  });
}

function snapshotToolAnnotations(
  value: CodingMcpToolAnnotations | undefined,
): CodingMcpToolAnnotations | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('coding-mcp-boundary:invalid-tool-annotations');
  }
  const output: Record<string, string | boolean> = {};
  for (const key of [
    'readOnlyHint',
    'destructiveHint',
    'idempotentHint',
    'openWorldHint',
  ] as const) {
    const candidate = value[key];
    if (candidate !== undefined && typeof candidate !== 'boolean') {
      throw new Error(`coding-mcp-boundary:invalid-tool-annotation:${key}`);
    }
    if (candidate !== undefined) output[key] = candidate;
  }
  if (value.title !== undefined) {
    if (typeof value.title !== 'string' || value.title.length > 1024) {
      throw new Error('coding-mcp-boundary:invalid-tool-annotation:title');
    }
    output.title = value.title;
  }
  return Object.freeze(output);
}

function snapshotToolArguments(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const snapshot = snapshotBoundedMcpValue(
    args,
    'tool-arguments',
    { maxDepth: 64, maxNodes: 32_768, maxCanonicalChars: MAX_MCP_TOOL_ARGUMENT_CHARS },
  );
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('coding-mcp-boundary:invalid-tool-arguments');
  }
  return snapshot as Readonly<Record<string, unknown>>;
}

function snapshotBoundedMcpValue(
  value: unknown,
  label: string,
  limits: {
    readonly maxDepth: number;
    readonly maxNodes: number;
    readonly maxCanonicalChars: number;
  },
): unknown {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!current.value || typeof current.value !== 'object') continue;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new Error(`coding-mcp-boundary:${label}-too-many-nodes`);
    }
    if (current.depth >= limits.maxDepth) {
      throw new Error(`coding-mcp-boundary:${label}-too-deep`);
    }
    for (const child of Object.values(current.value)) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  const snapshot = snapshotCodingValue(value, `mcp-${label}`);
  assertMcpCanonicalSize(snapshot, limits.maxCanonicalChars, label);
  return snapshot;
}

function assertMcpCanonicalSize(value: unknown, maxChars: number, label: string): void {
  if (canonicalCodingJson(value).length > maxChars) {
    throw new Error(`coding-mcp-boundary:${label}-too-large`);
  }
}

function normalizeApproval(
  approval: CodingMcpAuthorityApproval,
  purpose: 'server-launch' | 'tool-call',
  requiresUserApproval = true,
): CodingMcpAuthorityApproval {
  if (!approval || !['allow', 'deny'].includes(approval.decision)) {
    throw new Error(`coding-mcp-boundary:invalid-${purpose}-decision`);
  }
  if (!['user', 'host-policy'].includes(approval.actor)) {
    throw new Error(`coding-mcp-boundary:invalid-${purpose}-actor`);
  }
  const reason = normalizedCodingId(approval.reason, `${purpose}-reason`);
  const evidenceRef = approval.evidenceRef?.trim();
  if (approval.decision === 'allow' && requiresUserApproval && approval.actor !== 'user') {
    throw new Error(`coding-mcp-boundary:${purpose}-requires-user-approval`);
  }
  if (approval.decision === 'allow' && !evidenceRef) {
    throw new Error(`coding-mcp-boundary:${purpose}-requires-approval-evidence`);
  }
  return Object.freeze({
    decision: approval.decision,
    actor: approval.actor,
    reason,
    ...(evidenceRef ? { evidenceRef } : {}),
  });
}

function snapshotLaunchReceipt(
  request: CodingMcpServerLaunchRequest,
  approval: CodingMcpAuthorityApproval,
): CodingMcpServerLaunchReceipt {
  return Object.freeze({
    version: CODING_MCP_SERVER_LAUNCH_RECEIPT_VERSION,
    serverName: request.serverName,
    requestSha256: request.requestSha256,
    configurationSha256: request.configurationSha256,
    decision: approval.decision,
    actor: approval.actor,
    reason: approval.reason,
    evidenceRefs: Object.freeze(uniqueCodingRefs(approval.evidenceRef ? [approval.evidenceRef] : [])),
  });
}

function snapshotToolCallReceipt(
  request: CodingMcpToolCallRequest,
  approval: CodingMcpAuthorityApproval,
): CodingMcpToolCallReceipt {
  return Object.freeze({
    version: CODING_MCP_TOOL_CALL_RECEIPT_VERSION,
    callId: request.callId,
    requestSha256: request.requestSha256,
    registrationSha256: request.registrationSha256,
    decision: approval.decision,
    actor: approval.actor,
    reason: approval.reason,
    evidenceRefs: Object.freeze(uniqueCodingRefs(approval.evidenceRef ? [approval.evidenceRef] : [])),
  });
}

function requirePreparedLaunch(
  launches: ReadonlyMap<string, PreparedLaunchState>,
  request: CodingMcpServerLaunchRequest,
): PreparedLaunchState {
  const state = launches.get(request?.requestSha256);
  if (!state || canonicalCodingJson(state.prepared.request) !== canonicalCodingJson(request)) {
    throw new Error('coding-mcp-boundary:unknown-launch-request');
  }
  return state;
}

function requirePendingToolCall(
  calls: ReadonlyMap<string, PendingToolCallState>,
  request: CodingMcpToolCallRequest,
): PendingToolCallState {
  const state = calls.get(request?.requestSha256);
  if (!state || canonicalCodingJson(state.request) !== canonicalCodingJson(request)) {
    throw new Error('coding-mcp-boundary:unknown-tool-call-request');
  }
  return state;
}

function requireAuthorizedReceipt<T extends { readonly decision: CodingMcpAuthorityDecision }>(
  recorded: T | undefined,
  candidate: T,
  purpose: 'server-launch' | 'tool-call',
): void {
  if (!recorded) throw new Error(`coding-mcp-boundary:${purpose}-not-authorized`);
  requireExactReceipt(recorded, candidate, `${purpose}-receipt-mismatch`);
  if (recorded.decision !== 'allow') {
    throw new Error(`coding-mcp-boundary:${purpose}-denied`);
  }
}

function requireExactReceipt(left: unknown, right: unknown, code: string): void {
  if (canonicalCodingJson(left) !== canonicalCodingJson(right)) {
    throw new Error(`coding-mcp-boundary:${code}`);
  }
}

function classifyMcpToolRisk(annotations: CodingMcpToolAnnotations | undefined): CodingMcpToolRisk {
  if (annotations?.destructiveHint === true) return 'destructive';
  if (annotations?.readOnlyHint === true && annotations.openWorldHint === false) return 'medium';
  return 'high';
}

function mcpFakeToolName(serverName: string, toolName: string): string {
  return `mcp__${safeFakeNameSegment(serverName)}__${safeFakeNameSegment(toolName)}`;
}

function safeFakeNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

function commandLabel(command: string): string {
  return command.split(/[\\/]/).filter(Boolean).at(-1) ?? '<command>';
}
