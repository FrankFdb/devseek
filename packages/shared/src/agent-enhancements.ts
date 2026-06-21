export type HookStage = 'beforeEdit' | 'afterEdit' | 'beforeValidate' | 'afterValidate';
export type SubagentKind = 'reviewer' | 'test-writer' | 'diagnostics' | 'migration-planner';
export type McpRiskLevel = 'read' | 'write' | 'network' | 'destructive';

export interface HookDefinition {
  id: string;
  stage: HookStage;
  command: string;
  fileGlobs?: readonly string[];
  requiresApproval?: boolean;
  description: string;
}

export interface HookPlan {
  stage: HookStage;
  hooks: readonly HookDefinition[];
  blockedReasons: readonly string[];
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
    return {
      name: heading || candidate.path.split('/').slice(-2, -1)[0] || 'skill',
      path: candidate.path,
      description,
      triggers: triggers.length > 0 ? triggers : inferTriggers(candidate.path, description),
    };
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

function summarizeScope(files: readonly string[]): string {
  if (files.length === 0) return 'devseek';
  const topLevels = [...new Set(files.map(file => file.split('/')[0] || file))];
  return topLevels.length === 1 ? topLevels[0] : 'multi-area';
}
