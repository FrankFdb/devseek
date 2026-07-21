export type HookStage = 'beforeEdit' | 'afterEdit' | 'beforeValidate' | 'afterValidate';
export type HookPolicyKind = 'veto' | 'warning' | 'evidence';
export type HookEffectKind = 'read' | 'write' | 'network' | 'terminal';
export type HookExecutionStatus = 'passed' | 'failed' | 'bypassed' | 'not-run';
export type SubagentKind = 'reviewer' | 'test-writer' | 'diagnostics' | 'migration-planner';
export type McpRiskLevel = 'read' | 'write' | 'network' | 'destructive';
export type McpTrustAction = 'allow' | 'approval-required' | 'veto';
export type PluginSupplyChainAction = 'allow' | 'veto';
export type ExtensionProfileKind = 'skill' | 'hook' | 'mcp' | 'plugin' | 'subagent';
export type ExtensionProfilePlanStatus = 'signed' | 'blocked';
export type ExtensionProfileSlotKind = 'task' | 'permission-fault';
export type ExtensionProfileSlotExecutionStatus = 'passed' | 'failed' | 'vetoed' | 'blocked';
export type SkillToolKind =
  | 'read'
  | 'search'
  | 'diagnostics'
  | 'plan'
  | 'memory'
  | 'edit'
  | 'terminal'
  | 'network'
  | 'mcp';
export type SkillPermissionAction = 'allow' | 'deny';

export const HOOK_POLICY_PROTOCOL = 'devseek.hook-policy/v1';
export const SKILL_EXECUTION_PROTOCOL = 'devseek.skill-execution/v1';
export const MCP_TRUST_PROTOCOL = 'devseek.mcp-trust/v1';
export const PLUGIN_SUPPLY_CHAIN_PROTOCOL = 'devseek.plugin-supply-chain/v1';
export const SUBAGENT_CONTRACT_PROTOCOL = 'devseek.subagent-contract/v1';
export const EXTENSION_PROFILE_PLAN_PROTOCOL = 'devseek.extension-profile-plan/v1';
export const EXTENSION_PROFILE_SLOT_EXECUTION_PROTOCOL = 'devseek.extension-profile-slot-execution/v1';
export const B4_EFFECT_AUTHORITY = 'B4-effect-authority';

export interface HookDefinition {
  id: string;
  stage: HookStage;
  command: string;
  fileGlobs?: readonly string[];
  requiresApproval?: boolean;
  policy?: HookPolicyKind;
  policyVersion?: string;
  effect?: HookEffectKind;
  description: string;
}

export interface HookPlan {
  stage: HookStage;
  hooks: readonly HookDefinition[];
  blockedReasons: readonly string[];
}

export interface HookPolicyPlanInput {
  stage: HookStage;
  changedFiles: readonly string[];
  hooks?: readonly HookDefinition[];
  executions?: readonly HookExecutionRecord[];
}

export interface HookExecutionRecord {
  hookId: string;
  status: HookExecutionStatus;
  exitCode?: number;
  reason?: string;
  evidenceRef?: string;
}

export interface HookPolicyHook {
  id: string;
  stage: HookStage;
  command: string;
  description: string;
  policyKind: HookPolicyKind;
  policyVersion: string;
  allowedToRun: boolean;
  directWriteAllowed: false;
  evidenceRefs: readonly string[];
}

export interface HookPolicyReceipt {
  protocol: typeof HOOK_POLICY_PROTOCOL;
  stage: HookStage;
  settlementAuthority: 'parent-kernel';
  trustRoot: false;
  directWriterAllowed: false;
  selectedHooks: readonly HookPolicyHook[];
  blockedReasons: readonly string[];
  violations: readonly string[];
  vetoes: readonly string[];
  warnings: readonly string[];
  hookFailures: readonly string[];
  bypassedHooks: readonly string[];
  evidenceRefs: readonly string[];
}

export interface SkillCandidate {
  path: string;
  content: string;
}

export interface SkillDescriptor {
  name: string;
  path: string;
  description: string;
  triggers: readonly string[];
  inputSchema?: Record<string, unknown>;
  declaredToolKinds?: readonly SkillToolKind[];
  completionClaimRequested?: boolean;
  parseIssues?: readonly string[];
  evidenceRef?: string;
}

export interface SkillExecutionPlanInput {
  prompt: string;
  candidates: readonly SkillCandidate[];
  requestedToolKinds?: readonly SkillToolKind[];
}

export interface SkillPermissionDecision {
  kind: SkillToolKind;
  action: SkillPermissionAction;
  reason: string;
}

export interface SkillExecutionSkill {
  name: string;
  path: string;
  description: string;
  triggers: readonly string[];
  selectedByTrigger: string;
  inputSchema: Record<string, unknown>;
  declaredToolKinds: readonly SkillToolKind[];
  completionClaimsAllowed: false;
  evidenceRefs: readonly string[];
}

export interface SkillExecutionReceipt {
  protocol: typeof SKILL_EXECUTION_PROTOCOL;
  settlementAuthority: 'parent-kernel';
  canCompleteTask: false;
  loadedSkills: readonly SkillExecutionSkill[];
  permissionDecisions: readonly SkillPermissionDecision[];
  blockedReasons: readonly string[];
  violations: readonly string[];
  evidenceRefs: readonly string[];
  unmatchedSkillCount: number;
}

export interface SubagentDescriptor {
  kind: SubagentKind;
  purpose: string;
  inputContract: readonly string[];
  outputContract: readonly string[];
  requiresApproval: boolean;
}

export interface McpToolDescriptor {
  server: string;
  name: string;
  description?: string;
  risk: McpRiskLevel;
  serverSignature?: string;
  capabilityToken?: string;
}

export interface McpPermissionDecision {
  tool: string;
  requiresApproval: boolean;
  inheritedPermissionDomain: string;
  reasons: readonly string[];
}

export interface McpTrustedServer {
  server: string;
  signature: string;
  permissionDomains: readonly string[];
  revoked?: boolean;
}

export interface McpTrustInput {
  tools: readonly McpToolDescriptor[];
  trustedServers: readonly McpTrustedServer[];
  callerPermissionDomains?: readonly string[];
}

export interface McpTrustDecision extends McpPermissionDecision {
  risk: McpRiskLevel;
  action: McpTrustAction;
  trustedServer: boolean;
  serverSigned: boolean;
  capabilityRefs: readonly string[];
  evidenceRefs: readonly string[];
}

export interface McpTrustReceipt {
  protocol: typeof MCP_TRUST_PROTOCOL;
  settlementAuthority: 'parent-kernel';
  effectAuthority: typeof B4_EFFECT_AUTHORITY;
  capabilityEscapesAllowed: false;
  decisions: readonly McpTrustDecision[];
  vetoes: readonly string[];
  violations: readonly string[];
  evidenceRefs: readonly string[];
}

export interface PluginManifestDescriptor {
  id: string;
  version: string;
  manifestDigest: string;
  signature?: string;
  dependencies?: readonly string[];
  updateFromVersion?: string;
}

export interface PluginRevocationRecord {
  id: string;
  version?: string;
}

export interface PluginSupplyChainInput {
  manifests: readonly PluginManifestDescriptor[];
  approvedManifests: readonly PluginManifestDescriptor[];
  minimumVersions?: Readonly<Record<string, string>>;
  revokedPlugins?: readonly PluginRevocationRecord[];
  allowedDependencies?: Readonly<Record<string, readonly string[]>>;
}

export interface PluginSupplyChainDecision {
  plugin: string;
  action: PluginSupplyChainAction;
  signatureVerified: boolean;
  versionStatus: 'current' | 'stale';
  dependencyClosure: readonly string[];
  revocationStatus: 'active' | 'revoked';
  updateChain: {
    fromVersion?: string;
    toVersion: string;
    allowed: boolean;
  };
  manifestEvidenceRefs: readonly string[];
  vetoes: readonly string[];
  evidenceRefs: readonly string[];
}

export interface PluginSupplyChainReceipt {
  protocol: typeof PLUGIN_SUPPLY_CHAIN_PROTOCOL;
  settlementAuthority: 'parent-kernel';
  effectAuthority: typeof B4_EFFECT_AUTHORITY;
  singleOwner: 'PluginSupplyChainService';
  decisions: readonly PluginSupplyChainDecision[];
  vetoes: readonly string[];
  violations: readonly string[];
  evidenceRefs: readonly string[];
}

export interface ExtensionProfilePlanInput {
  kind: ExtensionProfileKind;
  candidateCommit: string;
  schemaVersion: string;
  oracleVersion?: string;
}

export interface ExtensionProfileSlot {
  slotId: string;
  slotKind: ExtensionProfileSlotKind;
  index: number;
  kind: ExtensionProfileKind;
  candidateCommit: string;
  schemaVersion: string;
  oracleRef: string;
}

export interface ExtensionProfileOracleCatalog {
  version: string;
  counts: {
    task: number;
    permissionFault: number;
  };
  oracleRefs: readonly string[];
}

export interface ExtensionProfilePlanReceipt {
  protocol: typeof EXTENSION_PROFILE_PLAN_PROTOCOL;
  profileId: string;
  kind: ExtensionProfileKind;
  status: ExtensionProfilePlanStatus;
  singleOwner: 'ExtensionProfilePlanService';
  settlementAuthority: 'parent-kernel';
  immutable: true;
  candidateCommit: string;
  schemaVersion: string;
  taskSlots: readonly ExtensionProfileSlot[];
  permissionFaultSlots: readonly ExtensionProfileSlot[];
  slotIds: readonly string[];
  oracleCatalog: ExtensionProfileOracleCatalog;
  denominatorExecutionAllowed: false;
  slotExecutionAllowed: false;
  aggregateExecutionAllowed: false;
  planSignature: string;
  violations: readonly string[];
  evidenceRefs: readonly string[];
}

export interface ExtensionProfileSlotExecutionInput {
  plan: ExtensionProfilePlanReceipt;
  slotId: string;
  attemptId: string;
  status: Exclude<ExtensionProfileSlotExecutionStatus, 'blocked'>;
  childReceipt?: ExtensionProfileSlotChildReceipt;
  effectRefs?: readonly string[];
  receiptRefs?: readonly string[];
  failureRefs?: readonly string[];
  vetoes?: readonly string[];
  previousReceipts?: readonly ExtensionProfileSlotExecutionReceipt[];
}

export interface ExtensionProfileSlotChildReceipt {
  protocol?: string;
  settlementAuthority?: string;
  evidenceRefs?: readonly string[];
  violations?: readonly string[];
  blockedReasons?: readonly string[];
  vetoes?: readonly string[];
}

export interface ExtensionProfileSlotExecutionReceipt {
  protocol: typeof EXTENSION_PROFILE_SLOT_EXECUTION_PROTOCOL;
  profileProtocol: typeof EXTENSION_PROFILE_PLAN_PROTOCOL;
  profileId: string;
  kind: ExtensionProfileKind;
  slotId: string;
  slotKind: ExtensionProfileSlotKind;
  index: number;
  status: ExtensionProfileSlotExecutionStatus;
  singleOwner: 'ExtensionProfilePlanService';
  settlementAuthority: 'parent-kernel';
  candidateCommit: string;
  schemaVersion: string;
  attemptId: string;
  previousAttemptIds: readonly string[];
  replacesPriorAttempt: false;
  priorAttemptPolicy: 'append-only-no-replacement';
  oracleRef: string;
  childReceiptRequired: boolean;
  childProtocol: string;
  childSettlementAuthority: string;
  childEvidenceRequired: boolean;
  childEvidenceRefs: readonly string[];
  childViolations: readonly string[];
  effectRefs: readonly string[];
  receiptRefs: readonly string[];
  failureRefs: readonly string[];
  vetoes: readonly string[];
  violations: readonly string[];
  evidenceRefs: readonly string[];
}

export interface GitPrSummaryInput {
  changedFiles: readonly string[];
  validationPassed: boolean;
  evidenceRefs: readonly string[];
  risks?: readonly string[];
}

export interface GitPrSummary {
  title: string;
  body: string;
  checklist: readonly string[];
}

const SENSITIVE_HOOK_DENY_PATTERNS = ['.env', '*.pem', '*.key', '*secret*'] as const;
const SKILL_ALLOWED_TOOL_KINDS: readonly SkillToolKind[] = ['read', 'search', 'diagnostics', 'plan'];
const EXTENSION_PROFILE_KINDS: readonly ExtensionProfileKind[] = ['skill', 'hook', 'mcp', 'plugin', 'subagent'];
const EXTENSION_PROFILE_TASK_SLOT_COUNT = 20;
const EXTENSION_PROFILE_PERMISSION_FAULT_SLOT_COUNT = 100;
const EXPECTED_EXTENSION_PROFILE_SCHEMAS: Readonly<Record<ExtensionProfileKind, string>> = {
  skill: SKILL_EXECUTION_PROTOCOL,
  hook: HOOK_POLICY_PROTOCOL,
  mcp: MCP_TRUST_PROTOCOL,
  plugin: PLUGIN_SUPPLY_CHAIN_PROTOCOL,
  subagent: SUBAGENT_CONTRACT_PROTOCOL,
};
const ALL_SKILL_TOOL_KINDS: readonly SkillToolKind[] = [
  'read',
  'search',
  'diagnostics',
  'plan',
  'memory',
  'edit',
  'terminal',
  'network',
  'mcp',
];

export class HookPlanner {
  plan(stage: HookStage, changedFiles: readonly string[], hooks: readonly HookDefinition[] = defaultHooks()): HookPlan {
    const blockedReasons = changedFiles
      .filter(file => SENSITIVE_HOOK_DENY_PATTERNS.some(pattern => matchesGlob(pattern, file)))
      .map(file => `sensitive-file:${file}`);
    return {
      stage,
      hooks: blockedReasons.length > 0 ? [] : hooks.filter(hook => hook.stage === stage && matchesAnyFile(hook, changedFiles)),
      blockedReasons,
    };
  }

  planPolicy(input: HookPolicyPlanInput): HookPolicyReceipt {
    const hookPlan = this.plan(input.stage, input.changedFiles, input.hooks ?? defaultHooks());
    const selectedHooks = hookPlan.hooks.map((hook): HookPolicyHook => {
      const directWriter = isDirectWriterHook(hook);
      return {
        id: hook.id,
        stage: hook.stage,
        command: hook.command,
        description: hook.description,
        policyKind: hook.policy ?? 'evidence',
        policyVersion: hook.policyVersion ?? HOOK_POLICY_PROTOCOL,
        allowedToRun: !directWriter,
        directWriteAllowed: false,
        evidenceRefs: [hookEvidenceRef(hook)],
      };
    });
    const selectedById = new Map(selectedHooks.map(hook => [hook.id, hook]));
    const directWriterViolations = selectedHooks
      .filter(hook => !hook.allowedToRun)
      .map(hook => `hook-direct-writer-denied:${hook.id}`);
    const executionViolations = (input.executions ?? []).flatMap((execution) => {
      if (!selectedById.has(execution.hookId)) return [`hook-result-without-selected-hook:${execution.hookId}`];
      if (execution.status === 'failed') return [`hook-failure-visible:${execution.hookId}`];
      if (execution.status === 'bypassed') return [`hook-bypass-visible:${execution.hookId}`];
      return [];
    });
    const hookFailures = (input.executions ?? [])
      .filter(execution => execution.status === 'failed')
      .map(execution => `hook-failure-visible:${execution.hookId}`);
    const bypassedHooks = (input.executions ?? [])
      .filter(execution => execution.status === 'bypassed')
      .map(execution => `hook-bypass-visible:${execution.hookId}`);
    const vetoes = uniqueStrings([
      ...hookPlan.blockedReasons,
      ...directWriterViolations,
      ...hookFailures.filter(failure => selectedById.get(failure.replace(/^hook-failure-visible:/, ''))?.policyKind === 'veto'),
      ...bypassedHooks.filter(bypass => selectedById.get(bypass.replace(/^hook-bypass-visible:/, ''))?.policyKind === 'veto'),
    ]);
    const warnings = uniqueStrings([
      ...hookFailures.filter(failure => selectedById.get(failure.replace(/^hook-failure-visible:/, ''))?.policyKind === 'warning'),
      ...bypassedHooks.filter(bypass => selectedById.get(bypass.replace(/^hook-bypass-visible:/, ''))?.policyKind === 'warning'),
    ]);
    const executionEvidenceRefs = (input.executions ?? []).map(hookExecutionEvidenceRef);
    return {
      protocol: HOOK_POLICY_PROTOCOL,
      stage: input.stage,
      settlementAuthority: 'parent-kernel',
      trustRoot: false,
      directWriterAllowed: false,
      selectedHooks,
      blockedReasons: uniqueStrings([...hookPlan.blockedReasons, ...directWriterViolations]),
      violations: uniqueStrings([...directWriterViolations, ...executionViolations]),
      vetoes,
      warnings,
      hookFailures: uniqueStrings(hookFailures),
      bypassedHooks: uniqueStrings(bypassedHooks),
      evidenceRefs: uniqueStrings([
        ...selectedHooks.flatMap(hook => hook.evidenceRefs),
        ...executionEvidenceRefs,
      ]),
    };
  }
}

export class SkillDiscoveryService {
  discover(candidates: readonly SkillCandidate[]): SkillDescriptor[] {
    return candidates
      .filter(candidate => candidate.path.endsWith('SKILL.md'))
      .map(candidate => this.parse(candidate));
  }

  select(prompt: string, skills: readonly SkillDescriptor[]): SkillDescriptor[] {
    const normalized = prompt.toLowerCase();
    return skills.filter(skill => skill.triggers.some(trigger => normalized.includes(trigger.toLowerCase())));
  }

  planExecution(input: SkillExecutionPlanInput): SkillExecutionReceipt {
    const discovered = this.discover(input.candidates);
    const selected = this.selectForExecution(input.prompt, discovered);
    const loadedSkills: SkillExecutionSkill[] = selected.map(({ skill, selectedByTrigger }) => ({
      name: skill.name,
      path: skill.path,
      description: skill.description,
      triggers: skill.triggers,
      selectedByTrigger,
      inputSchema: skill.inputSchema ?? defaultSkillInputSchema(),
      declaredToolKinds: skill.declaredToolKinds ?? [],
      completionClaimsAllowed: false,
      evidenceRefs: [skill.evidenceRef ?? skillEvidenceRef(skill.path, skill.description)],
    }));
    const permissionDecisions = planSkillPermissions(loadedSkills, input.requestedToolKinds ?? []);
    const violations = uniqueStrings([
      ...loadedSkills.flatMap(skill => (
        selected.find(item => item.skill.path === skill.path)?.skill.completionClaimRequested
          ? ['skill-completion-claim-rejected']
          : []
      )),
      ...selected.flatMap(item => item.skill.parseIssues ?? []),
      ...permissionDecisions
        .filter(decision => decision.action === 'deny')
        .map(decision => decision.reason),
    ]);
    return {
      protocol: SKILL_EXECUTION_PROTOCOL,
      settlementAuthority: 'parent-kernel',
      canCompleteTask: false,
      loadedSkills,
      permissionDecisions,
      blockedReasons: loadedSkills.length === 0 && discovered.length > 0 ? ['unmatched-skill-not-loaded'] : [],
      violations,
      evidenceRefs: uniqueStrings(loadedSkills.flatMap(skill => skill.evidenceRefs)),
      unmatchedSkillCount: Math.max(discovered.length - loadedSkills.length, 0),
    };
  }

  private parse(candidate: SkillCandidate): SkillDescriptor {
    const lines = candidate.content.split(/\r?\n/);
    const heading = lines.find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim();
    const description = lines.find(line => /^description\s*:/i.test(line))?.replace(/^description\s*:\s*/i, '').trim()
      ?? lines.find(line => line.trim() && !line.startsWith('#'))?.trim()
      ?? 'No description provided.';
    const triggers = lines
      .filter(line => /^triggers\s*:/i.test(line))
      .flatMap(line => line.replace(/^triggers\s*:\s*/i, '').split(','))
      .map(trigger => trigger.trim())
      .filter(Boolean);
    const schema = parseSkillInputSchema(lines, candidate.path);
    return {
      name: heading || candidate.path.split('/').slice(-2, -1)[0] || 'skill',
      path: candidate.path,
      description,
      triggers: triggers.length > 0 ? triggers : inferTriggers(candidate.path, description),
      inputSchema: schema.inputSchema,
      declaredToolKinds: parseSkillToolKinds(lines),
      completionClaimRequested: parseCompletionClaimRequested(lines),
      parseIssues: schema.issue ? [schema.issue] : [],
      evidenceRef: skillEvidenceRef(candidate.path, candidate.content),
    };
  }

  private selectForExecution(prompt: string, skills: readonly SkillDescriptor[]): Array<{
    skill: SkillDescriptor;
    selectedByTrigger: string;
  }> {
    const normalized = prompt.toLowerCase();
    return skills.flatMap((skill) => {
      const selectedByTrigger = skill.triggers.find(trigger => normalized.includes(trigger.toLowerCase()));
      return selectedByTrigger ? [{ skill, selectedByTrigger }] : [];
    });
  }
}

export class SubagentRegistry {
  list(): SubagentDescriptor[] {
    return [
      {
        kind: 'reviewer',
        purpose: 'Review produced changes for correctness, regressions, security, and missing tests.',
        inputContract: ['changedFiles', 'diffSummary', 'validationEvidence'],
        outputContract: ['findings', 'riskLevel', 'followUpTests'],
        requiresApproval: false,
      },
      {
        kind: 'test-writer',
        purpose: 'Design focused tests that reproduce the failure before and after the fix.',
        inputContract: ['bugReport', 'affectedModules', 'existingTestStyle'],
        outputContract: ['testPlan', 'testFiles', 'expectedFailureBeforeFix'],
        requiresApproval: false,
      },
      {
        kind: 'diagnostics',
        purpose: 'Inspect logs, build failures, and environment facts without modifying files.',
        inputContract: ['errorOutput', 'environmentProfile', 'relevantFiles'],
        outputContract: ['rootCause', 'evidenceRefs', 'nextActions'],
        requiresApproval: false,
      },
      {
        kind: 'migration-planner',
        purpose: 'Plan broad refactors with rollback, sequencing, and module ownership boundaries.',
        inputContract: ['architectureGoal', 'moduleMap', 'riskBudget'],
        outputContract: ['migrationPlan', 'rollbackPlan', 'verificationMatrix'],
        requiresApproval: true,
      },
    ];
  }

  select(task: { prompt: string; changedFileCount?: number; validationFailed?: boolean }): SubagentDescriptor[] {
    const prompt = task.prompt.toLowerCase();
    const selected = new Set<SubagentKind>();
    if (task.validationFailed || /error|failed|失败|报错/.test(prompt)) selected.add('diagnostics');
    if (/test|测试|case|reproduce|复现/.test(prompt)) selected.add('test-writer');
    if ((task.changedFileCount ?? 0) > 3 || /refactor|重构|migration|架构/.test(prompt)) selected.add('migration-planner');
    selected.add('reviewer');
    return this.list().filter(agent => selected.has(agent.kind));
  }
}

export class McpPermissionService {
  decide(tool: McpToolDescriptor): McpPermissionDecision {
    const inheritedPermissionDomain = tool.risk === 'read'
      ? 'inspect'
      : tool.risk === 'network'
        ? 'network'
        : tool.risk === 'write'
          ? 'edit'
          : 'destructive';
    return {
      tool: `${tool.server}.${tool.name}`,
      requiresApproval: tool.risk !== 'read',
      inheritedPermissionDomain,
      reasons: tool.risk === 'read' ? [] : [`mcp-${tool.risk}-tool`],
    };
  }

  evaluateTrust(input: McpTrustInput): McpTrustReceipt {
    const trustedServers = new Map(input.trustedServers.map(server => [server.server, server]));
    const callerDomains = new Set(input.callerPermissionDomains ?? []);
    const decisions = input.tools.map((tool): McpTrustDecision => {
      const base = this.decide(tool);
      const trustedServer = trustedServers.get(tool.server);
      const signatureMatches = Boolean(
        trustedServer
        && tool.serverSignature
        && tool.serverSignature === trustedServer.signature,
      );
      const vetoes = mcpToolVetoes({
        tool,
        trustedServer,
        signatureMatches,
        inheritedPermissionDomain: base.inheritedPermissionDomain,
        callerDomains,
      });
      const capabilityRefs = tool.capabilityToken ? [mcpCapabilityRef(tool)] : [];
      const evidenceRefs = uniqueStrings([
        mcpToolEvidenceRef(tool, signatureMatches),
        ...capabilityRefs,
      ]);
      return {
        ...base,
        risk: tool.risk,
        action: vetoes.length > 0 ? 'veto' : base.requiresApproval ? 'approval-required' : 'allow',
        trustedServer: Boolean(trustedServer && !trustedServer.revoked),
        serverSigned: signatureMatches,
        capabilityRefs,
        evidenceRefs,
        reasons: uniqueStrings([...base.reasons, ...vetoes]),
      };
    });
    const vetoes = uniqueStrings(decisions.flatMap(decision => decision.reasons.filter(reason => reason.endsWith(`:${decision.tool}`))));
    return {
      protocol: MCP_TRUST_PROTOCOL,
      settlementAuthority: 'parent-kernel',
      effectAuthority: B4_EFFECT_AUTHORITY,
      capabilityEscapesAllowed: false,
      decisions,
      vetoes,
      violations: vetoes,
      evidenceRefs: uniqueStrings(decisions.flatMap(decision => decision.evidenceRefs)),
    };
  }
}

function mcpToolVetoes(input: {
  tool: McpToolDescriptor;
  trustedServer: McpTrustedServer | undefined;
  signatureMatches: boolean;
  inheritedPermissionDomain: string;
  callerDomains: ReadonlySet<string>;
}): string[] {
  const { tool, trustedServer, signatureMatches, inheritedPermissionDomain, callerDomains } = input;
  const toolId = mcpToolId(tool);
  const mutable = tool.risk !== 'read';
  const reasons: string[] = [];
  if (trustedServer?.revoked) {
    reasons.push(`mcp-revoked-server-veto:${toolId}`);
  } else if (mutable && !trustedServer) {
    reasons.push(`mcp-unknown-mutable-veto:${toolId}`);
  } else if (mutable && !signatureMatches) {
    reasons.push(`mcp-unsigned-server-veto:${toolId}`);
  }
  if (mutable && callerDomains.size > 0 && !callerDomains.has(inheritedPermissionDomain)) {
    reasons.push(`mcp-permission-escape-veto:${toolId}`);
  }
  return reasons;
}

function mcpToolId(tool: McpToolDescriptor): string {
  return `${tool.server}.${tool.name}`;
}

function mcpToolEvidenceRef(tool: McpToolDescriptor, signatureMatches: boolean): string {
  return `mcp-tool:${mcpToolId(tool)}:${stableTextDigest([
    tool.risk,
    signatureMatches ? 'signed' : 'unsigned',
    tool.description ?? '',
  ].join('\n'))}`;
}

function mcpCapabilityRef(tool: McpToolDescriptor): string {
  return `mcp-capability:${mcpToolId(tool)}:${stableTextDigest(tool.capabilityToken ?? '')}`;
}

export class PluginSupplyChainService {
  evaluate(input: PluginSupplyChainInput): PluginSupplyChainReceipt {
    const approved = new Map(input.approvedManifests.map(manifest => [pluginManifestId(manifest), manifest]));
    const decisions = input.manifests.map((manifest): PluginSupplyChainDecision => {
      const plugin = pluginManifestId(manifest);
      const approvedManifest = approved.get(plugin);
      const signatureVerified = Boolean(
        manifest.signature
        && approvedManifest
        && manifest.signature === approvedManifest.signature
        && manifest.manifestDigest === approvedManifest.manifestDigest,
      );
      const versionStatus = isPluginVersionStale(manifest, input.minimumVersions ?? {}) ? 'stale' : 'current';
      const revocationStatus = isPluginRevoked(manifest, input.revokedPlugins ?? []) ? 'revoked' : 'active';
      const dependencyClosure = manifest.dependencies ?? [];
      const updateAllowed = !manifest.updateFromVersion || compareVersions(manifest.updateFromVersion, manifest.version) <= 0;
      const vetoes = pluginVetoes({
        manifest,
        signatureVerified,
        versionStatus,
        revocationStatus,
        dependencyClosure,
        allowedDependencies: input.allowedDependencies ?? {},
        updateAllowed,
      });
      const manifestEvidenceRefs = [pluginManifestEvidenceRef(manifest)];
      return {
        plugin,
        action: vetoes.length > 0 ? 'veto' : 'allow',
        signatureVerified,
        versionStatus,
        dependencyClosure,
        revocationStatus,
        updateChain: {
          fromVersion: manifest.updateFromVersion,
          toVersion: manifest.version,
          allowed: updateAllowed,
        },
        manifestEvidenceRefs,
        vetoes,
        evidenceRefs: manifestEvidenceRefs,
      };
    });
    const vetoes = uniqueStrings(decisions.flatMap(decision => decision.vetoes));
    return {
      protocol: PLUGIN_SUPPLY_CHAIN_PROTOCOL,
      settlementAuthority: 'parent-kernel',
      effectAuthority: B4_EFFECT_AUTHORITY,
      singleOwner: 'PluginSupplyChainService',
      decisions,
      vetoes,
      violations: vetoes,
      evidenceRefs: uniqueStrings(decisions.flatMap(decision => decision.evidenceRefs)),
    };
  }
}

export class ExtensionProfilePlanService {
  createProfilePlan(input: ExtensionProfilePlanInput): ExtensionProfilePlanReceipt {
    const requestedKind = String(input.kind ?? '').trim() as ExtensionProfileKind;
    const kind = toExtensionProfileKind(requestedKind);
    const candidateCommit = String(input.candidateCommit ?? '').trim();
    const schemaVersion = String(input.schemaVersion ?? '').trim();
    const oracleVersion = String(input.oracleVersion ?? `${EXTENSION_PROFILE_PLAN_PROTOCOL}:oracle/v1`).trim();
    const expectedSchemaVersion = EXPECTED_EXTENSION_PROFILE_SCHEMAS[kind];
    const violations = uniqueStrings([
      ...(!candidateCommit ? ['profile-plan-missing-candidate-commit'] : []),
      ...(!schemaVersion ? ['profile-plan-missing-schema-version'] : []),
      ...(!isExtensionProfileKind(requestedKind) ? ['profile-plan-invalid-kind'] : []),
      ...(schemaVersion && schemaVersion !== expectedSchemaVersion ? [`profile-plan-schema-kind-mismatch:${kind}`] : []),
    ]);
    const taskSlots = createExtensionProfileSlots({
      kind,
      slotKind: 'task',
      count: EXTENSION_PROFILE_TASK_SLOT_COUNT,
      candidateCommit,
      schemaVersion,
      oracleVersion,
    });
    const permissionFaultSlots = createExtensionProfileSlots({
      kind,
      slotKind: 'permission-fault',
      count: EXTENSION_PROFILE_PERMISSION_FAULT_SLOT_COUNT,
      candidateCommit,
      schemaVersion,
      oracleVersion,
    });
    const slotIds = [...taskSlots, ...permissionFaultSlots].map(slot => slot.slotId);
    const oracleRefs = [...taskSlots, ...permissionFaultSlots].map(slot => slot.oracleRef);
    const profileId = `R3-07F-${kind}-PROFILE-PLAN`;
    const planSignature = stableTextDigest(JSON.stringify({
      protocol: EXTENSION_PROFILE_PLAN_PROTOCOL,
      profileId,
      kind,
      candidateCommit,
      schemaVersion,
      taskSlots,
      permissionFaultSlots,
      oracleVersion,
      violations,
    }));

    return {
      protocol: EXTENSION_PROFILE_PLAN_PROTOCOL,
      profileId,
      kind,
      status: violations.length === 0 ? 'signed' : 'blocked',
      singleOwner: 'ExtensionProfilePlanService',
      settlementAuthority: 'parent-kernel',
      immutable: true,
      candidateCommit,
      schemaVersion,
      taskSlots,
      permissionFaultSlots,
      slotIds,
      oracleCatalog: {
        version: oracleVersion,
        counts: {
          task: taskSlots.length,
          permissionFault: permissionFaultSlots.length,
        },
        oracleRefs,
      },
      denominatorExecutionAllowed: false,
      slotExecutionAllowed: false,
      aggregateExecutionAllowed: false,
      planSignature,
      violations,
      evidenceRefs: [`extension-profile-plan:${profileId}:${planSignature}`],
    };
  }

  recordSlotExecution(input: ExtensionProfileSlotExecutionInput): ExtensionProfileSlotExecutionReceipt {
    const plan = input.plan;
    const slotId = String(input.slotId ?? '').trim();
    const attemptId = String(input.attemptId ?? '').trim();
    const slot = findExtensionProfileSlot(plan, slotId);
    const childReceipt = input.childReceipt;
    const childProtocol = String(childReceipt?.protocol ?? '').trim();
    const childSettlementAuthority = String(childReceipt?.settlementAuthority ?? '').trim();
    const childEvidenceRefs = uniqueStrings(childReceipt?.evidenceRefs ?? []);
    const childViolations = uniqueStrings([
      ...(childReceipt?.violations ?? []),
      ...(childReceipt?.blockedReasons ?? []),
      ...(childReceipt?.vetoes ?? []),
    ]);
    const childReceiptRequired = input.status === 'passed';
    const childEvidenceRequired = childReceiptRequired;
    const expectedChildProtocol = EXPECTED_EXTENSION_PROFILE_SCHEMAS[plan.kind];
    const childReceiptVetoes = childReceiptRequired
      ? uniqueStrings([
        ...(childReceipt ? [] : [`slot-child-receipt-missing-veto:${slotId}`]),
        ...(childReceipt && childProtocol !== expectedChildProtocol ? [`slot-child-protocol-mismatch-veto:${slotId}`] : []),
        ...(childReceipt && childEvidenceRefs.length === 0 ? [`slot-child-evidence-missing-veto:${slotId}`] : []),
        ...(childReceipt && childSettlementAuthority !== 'parent-kernel' ? [`slot-child-settlement-authority-veto:${slotId}`] : []),
        ...(childViolations.length > 0 ? [`slot-child-receipt-not-clean-veto:${slotId}`] : []),
      ])
      : [];
    const previousAttemptIds = uniqueStrings(
      (input.previousReceipts ?? [])
        .filter(receipt => receipt.slotId === slotId)
        .map(receipt => receipt.attemptId),
    );
    const vetoes = uniqueStrings([
      ...(plan.status === 'signed' ? [] : [`slot-plan-not-signed-veto:${plan.profileId}`]),
      ...(attemptId ? [] : [`slot-missing-attempt-veto:${slotId}`]),
      ...(slot ? [] : [`slot-not-in-profile-veto:${slotId}`]),
      ...(previousAttemptIds.length === 0 ? [] : [`slot-replacement-veto:${slotId}`]),
      ...childReceiptVetoes,
      ...(input.vetoes ?? []),
    ]);
    const status: ExtensionProfileSlotExecutionStatus = vetoes.length > 0 ? 'blocked' : input.status;
    const effectRefs = status === 'blocked' ? [] : uniqueStrings(input.effectRefs ?? []);
    const receiptRefs = status === 'blocked' ? [] : uniqueStrings(input.receiptRefs ?? []);
    const failureRefs = uniqueStrings(input.failureRefs ?? []);
    const oracleRef = slot?.oracleRef ?? '';

    return {
      protocol: EXTENSION_PROFILE_SLOT_EXECUTION_PROTOCOL,
      profileProtocol: EXTENSION_PROFILE_PLAN_PROTOCOL,
      profileId: plan.profileId,
      kind: plan.kind,
      slotId,
      slotKind: slot?.slotKind ?? 'task',
      index: slot?.index ?? 0,
      status,
      singleOwner: 'ExtensionProfilePlanService',
      settlementAuthority: 'parent-kernel',
      candidateCommit: plan.candidateCommit,
      schemaVersion: plan.schemaVersion,
      attemptId,
      previousAttemptIds,
      replacesPriorAttempt: false,
      priorAttemptPolicy: 'append-only-no-replacement',
      oracleRef,
      childReceiptRequired,
      childProtocol,
      childSettlementAuthority,
      childEvidenceRequired,
      childEvidenceRefs,
      childViolations,
      effectRefs,
      receiptRefs,
      failureRefs,
      vetoes,
      violations: vetoes,
      evidenceRefs: uniqueStrings([
        ...plan.evidenceRefs,
        oracleRef,
        ...effectRefs,
        ...receiptRefs,
        ...failureRefs,
        ...childEvidenceRefs,
        ...childViolations,
        ...vetoes,
      ]),
    };
  }
}

function toExtensionProfileKind(kind: ExtensionProfileKind): ExtensionProfileKind {
  return isExtensionProfileKind(kind) ? kind : 'skill';
}

function findExtensionProfileSlot(
  plan: ExtensionProfilePlanReceipt,
  slotId: string,
): ExtensionProfileSlot | undefined {
  return [...plan.taskSlots, ...plan.permissionFaultSlots].find(slot => slot.slotId === slotId);
}

function isExtensionProfileKind(kind: string): kind is ExtensionProfileKind {
  return (EXTENSION_PROFILE_KINDS as readonly string[]).includes(kind);
}

function createExtensionProfileSlots(input: {
  kind: ExtensionProfileKind;
  slotKind: ExtensionProfileSlotKind;
  count: number;
  candidateCommit: string;
  schemaVersion: string;
  oracleVersion: string;
}): ExtensionProfileSlot[] {
  return Array.from({ length: input.count }, (_, index) => {
    const slotIndex = index + 1;
    const slotLabel = input.slotKind === 'task' ? 'TASK' : 'PERMISSION-FAULT';
    const slotId = `R3-07S-${input.kind}-${slotLabel}-${String(slotIndex).padStart(3, '0')}`;
    const oracleRef = [
      'oracle',
      input.kind,
      input.slotKind,
      String(slotIndex).padStart(3, '0'),
      stableTextDigest(`${input.oracleVersion}\n${input.candidateCommit}\n${input.schemaVersion}\n${slotId}`),
    ].join(':');
    return {
      slotId,
      slotKind: input.slotKind,
      index: slotIndex,
      kind: input.kind,
      candidateCommit: input.candidateCommit,
      schemaVersion: input.schemaVersion,
      oracleRef,
    };
  });
}

function pluginVetoes(input: {
  manifest: PluginManifestDescriptor;
  signatureVerified: boolean;
  versionStatus: 'current' | 'stale';
  revocationStatus: 'active' | 'revoked';
  dependencyClosure: readonly string[];
  allowedDependencies: Readonly<Record<string, readonly string[]>>;
  updateAllowed: boolean;
}): string[] {
  const { manifest, signatureVerified, versionStatus, revocationStatus, dependencyClosure, allowedDependencies, updateAllowed } = input;
  const plugin = pluginManifestId(manifest);
  const vetoes: string[] = [];
  if (!manifest.signature) vetoes.push(`plugin-unsigned-veto:${plugin}`);
  else if (!signatureVerified) vetoes.push(`plugin-tampered-veto:${plugin}`);
  if (versionStatus === 'stale') vetoes.push(`plugin-stale-version-veto:${plugin}`);
  if (revocationStatus === 'revoked') vetoes.push(`plugin-revoked-veto:${plugin}`);
  const allowed = new Set(allowedDependencies[manifest.id] ?? []);
  for (const dependency of dependencyClosure) {
    if (!allowed.has(dependency)) vetoes.push(`plugin-dependency-veto:${plugin}->${dependency}`);
  }
  if (!updateAllowed) vetoes.push(`plugin-downgrade-update-veto:${plugin}`);
  return uniqueStrings(vetoes);
}

function pluginManifestId(manifest: Pick<PluginManifestDescriptor, 'id' | 'version'>): string {
  return `${manifest.id}@${manifest.version}`;
}

function isPluginVersionStale(
  manifest: PluginManifestDescriptor,
  minimumVersions: Readonly<Record<string, string>>,
): boolean {
  const minimum = minimumVersions[manifest.id];
  return Boolean(minimum && compareVersions(manifest.version, minimum) < 0);
}

function isPluginRevoked(manifest: PluginManifestDescriptor, revoked: readonly PluginRevocationRecord[]): boolean {
  return revoked.some(record => record.id === manifest.id && (!record.version || record.version === manifest.version));
}

function pluginManifestEvidenceRef(manifest: PluginManifestDescriptor): string {
  return `plugin-manifest:${pluginManifestId(manifest)}:${stableTextDigest([
    manifest.manifestDigest,
    manifest.signature ?? 'unsigned',
    ...(manifest.dependencies ?? []),
    manifest.updateFromVersion ?? '',
  ].join('\n'))}`;
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function versionParts(version: string): number[] {
  return version.split(/[.-]/).map(part => Number.parseInt(part, 10)).map(part => Number.isFinite(part) ? part : 0);
}

export class GitPrAssistantService {
  summarize(input: GitPrSummaryInput): GitPrSummary {
    const scope = summarizeScope(input.changedFiles);
    const status = input.validationPassed ? 'validated' : 'needs validation';
    return {
      title: `${scope}: ${status}`,
      body: [
        `Changed files: ${input.changedFiles.length}`,
        `Validation: ${input.validationPassed ? 'passed' : 'not passed'}`,
        `Evidence: ${input.evidenceRefs.length ? input.evidenceRefs.join(', ') : 'none'}`,
        input.risks?.length ? `Risks: ${input.risks.join(', ')}` : undefined,
      ].filter(Boolean).join('\n'),
      checklist: [
        'Implementation follows AgentCommand / AgentEvent boundaries',
        'Permissions, validation evidence, and QualityGate state are recorded',
        'Manual VS Code surface cases are updated when UI behavior changes',
      ],
    };
  }
}

function isDirectWriterHook(hook: HookDefinition): boolean {
  if (hook.effect === 'write') return true;
  if (hook.effect) return false;
  return /\b(?:format|fix|write|rewrite)\b|--write|--fix/i.test(hook.command);
}

function hookEvidenceRef(hook: HookDefinition): string {
  return `hook:${hook.id}:${stableTextDigest([
    hook.stage,
    hook.command,
    hook.policy ?? 'evidence',
    hook.policyVersion ?? HOOK_POLICY_PROTOCOL,
    hook.effect ?? 'unspecified',
  ].join('\n'))}`;
}

function hookExecutionEvidenceRef(execution: HookExecutionRecord): string {
  if (execution.evidenceRef) return execution.evidenceRef;
  const prefix = execution.status === 'bypassed'
    ? 'hook-bypass'
    : execution.status === 'failed'
      ? 'hook-failure'
      : `hook-${execution.status}`;
  return `${prefix}:${execution.hookId}:${stableTextDigest([
    execution.status,
    execution.exitCode === undefined ? '' : String(execution.exitCode),
    execution.reason ?? '',
  ].join('\n'))}`;
}

function defaultHooks(): HookDefinition[] {
  return [
    {
      id: 'format-typescript',
      stage: 'afterEdit',
      command: 'npm run format',
      fileGlobs: ['*.ts', '*.tsx'],
      description: 'Format TypeScript files after edits when the project provides a formatter.',
    },
    {
      id: 'run-focused-tests',
      stage: 'beforeValidate',
      command: 'npm test -- --runInBand',
      fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx'],
      requiresApproval: false,
      description: 'Run focused tests before QualityGate.',
    },
    {
      id: 'block-sensitive-write',
      stage: 'beforeEdit',
      command: 'deny',
      fileGlobs: ['.env', '*.pem', '*.key'],
      requiresApproval: true,
      description: 'Require explicit approval before sensitive file writes.',
    },
  ];
}

function matchesAnyFile(hook: HookDefinition, files: readonly string[]): boolean {
  if (!hook.fileGlobs?.length) return true;
  return files.some(file => hook.fileGlobs?.some(glob => matchesGlob(glob, file)));
}

function matchesGlob(glob: string, file: string): boolean {
  const name = file.replace(/\\/g, '/').split('/').pop() ?? file;
  if (!glob.includes('*')) return name === glob || file.endsWith(`/${glob}`);
  const regex = new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return regex.test(name) || regex.test(file);
}

function inferTriggers(path: string, description: string): string[] {
  const words = `${path} ${description}`.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [];
  return [...new Set(words)].slice(0, 8);
}

function parseSkillInputSchema(lines: readonly string[], skillPath: string): {
  inputSchema: Record<string, unknown>;
  issue?: string;
} {
  const schemaLine = lines.find(line => /^(?:input_schema|inputSchema|schema)\s*:/i.test(line));
  if (!schemaLine) return { inputSchema: defaultSkillInputSchema() };
  const rawSchema = schemaLine.replace(/^(?:input_schema|inputSchema|schema)\s*:\s*/i, '').trim();
  try {
    const parsed = JSON.parse(rawSchema);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { inputSchema: parsed as Record<string, unknown> };
    }
  } catch {
    // Fall through to a fail-closed schema issue below.
  }
  return {
    inputSchema: defaultSkillInputSchema(),
    issue: `skill-schema-invalid:${skillPath}`,
  };
}

function defaultSkillInputSchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: true };
}

function parseSkillToolKinds(lines: readonly string[]): SkillToolKind[] {
  return uniqueStrings(lines
    .filter(line => /^(?:tool_kinds|toolKinds|tools)\s*:/i.test(line))
    .flatMap(line => line.replace(/^(?:tool_kinds|toolKinds|tools)\s*:\s*/i, '').split(','))
    .map(value => value.trim().toLowerCase()))
    .flatMap(toSkillToolKind);
}

function toSkillToolKind(value: string): SkillToolKind[] {
  return (ALL_SKILL_TOOL_KINDS as readonly string[]).includes(value) ? [value as SkillToolKind] : [];
}

function parseCompletionClaimRequested(lines: readonly string[]): boolean {
  const line = lines.find(value => /^(?:can_complete|canComplete|completion_claims|completionClaims)\s*:/i.test(value));
  if (!line) return false;
  const value = line.replace(/^(?:can_complete|canComplete|completion_claims|completionClaims)\s*:\s*/i, '').trim().toLowerCase();
  return value === 'true' || value === 'yes' || value === 'allowed' || value === 'allow';
}

function planSkillPermissions(
  loadedSkills: readonly SkillExecutionSkill[],
  requestedToolKinds: readonly SkillToolKind[],
): SkillPermissionDecision[] {
  const plannedKinds = uniqueStrings([
    ...requestedToolKinds,
    ...loadedSkills.flatMap(skill => skill.declaredToolKinds),
  ]) as SkillToolKind[];
  return plannedKinds.map((kind) => {
    if (SKILL_ALLOWED_TOOL_KINDS.includes(kind)) {
      return { kind, action: 'allow', reason: `skill-tool-kind-allowed:${kind}` };
    }
    return { kind, action: 'deny', reason: `skill-tool-kind-denied:${kind}` };
  });
}

function skillEvidenceRef(path: string, content: string): string {
  return `skill:${path}:${stableTextDigest(content)}`;
}

function stableTextDigest(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function summarizeScope(files: readonly string[]): string {
  if (files.length === 0) return 'devseek';
  const topLevels = [...new Set(files.map(file => file.split('/')[0] || file))];
  return topLevels.length === 1 ? topLevels[0] : 'multi-area';
}
