export type HookStage = 'beforeEdit' | 'afterEdit' | 'beforeValidate' | 'afterValidate';
export type HookPolicyKind = 'veto' | 'warning' | 'evidence';
export type HookEffectKind = 'read' | 'write' | 'network' | 'terminal';
export type HookExecutionStatus = 'passed' | 'failed' | 'bypassed' | 'not-run';
export type SubagentKind = 'reviewer' | 'test-writer' | 'diagnostics' | 'migration-planner';
export type McpRiskLevel = 'read' | 'write' | 'network' | 'destructive';
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
}

export interface McpPermissionDecision {
  tool: string;
  requiresApproval: boolean;
  inheritedPermissionDomain: string;
  reasons: readonly string[];
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
