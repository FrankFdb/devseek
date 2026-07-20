export type ContextSourceKind =
  | 'project-instruction'
  | 'memory'
  | 'active-editor'
  | 'diagnostics'
  | 'attachment'
  | 'session'
  | 'system';

export interface ContextSource {
  id: string;
  kind: ContextSourceKind;
  label: string;
  content: string;
  path?: string;
  priority?: number;
  critical?: boolean;
  canTruncate?: boolean;
}

export interface ContextSourceReport {
  id: string;
  kind: ContextSourceKind;
  label: string;
  path?: string;
  originalChars: number;
  includedChars: number;
  truncated: boolean;
  omitted: boolean;
  critical: boolean;
  sourceIntegrity: 'full' | 'preview' | 'omitted';
  omissionReason?: ContextOmissionReason;
}

export type ContextBudgetDecision = 'allow' | 'replan' | 'blocked';

export type ContextOmissionReason =
  | 'preview-truncated-for-budget'
  | 'context-budget-exhausted'
  | 'critical-evidence-exceeds-budget'
  | 'nontruncatable-source-exceeds-budget';

export interface ContextOmissionReport {
  id: string;
  reason: ContextOmissionReason;
  critical: boolean;
  originalChars: number;
  includedChars: number;
  omittedChars: number;
}

export interface ContextUsageBudget {
  maxChars: number;
  usedChars: number;
  remainingChars: number;
  criticalIncludedChars: number;
  previewIncludedChars: number;
  omittedChars: number;
}

export interface ContextBudgetReport {
  version: typeof CONTEXT_BUDGET_PROTOCOL_VERSION;
  decision: ContextBudgetDecision;
  replanRequired: boolean;
  maxChars: number;
  usedChars: number;
  remainingChars: number;
  includedSources: string[];
  truncatedSources: string[];
  omittedSources: string[];
  blockedSources: string[];
  omissionReport: ContextOmissionReport[];
  usageBudget: ContextUsageBudget;
}

export interface PromptContext {
  prompt: string;
  sources: ContextSourceReport[];
  budget: ContextBudgetReport;
}

export interface AssemblePromptOptions {
  maxChars?: number;
  delimiter?: string;
}

const DEFAULT_MAX_CONTEXT_CHARS = 16_000;
const DEFAULT_DELIMITER = '\n\n---\n\n';
export const CONTEXT_BUDGET_PROTOCOL_VERSION = 'devseek.context-budget/v1';

export class ContextAssemblyService {
  assemble(basePrompt: string, sources: ContextSource[], options: AssemblePromptOptions = {}): PromptContext {
    const maxChars = options.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const delimiter = options.delimiter ?? DEFAULT_DELIMITER;
    const ordered = [...sources].sort((a, b) => {
      if (a.critical !== b.critical) return a.critical ? -1 : 1;
      return (a.priority ?? 100) - (b.priority ?? 100);
    });

    const sections: string[] = [];
    const reports: ContextSourceReport[] = [];
    const includedSources: string[] = [];
    const truncatedSources: string[] = [];
    const omittedSources: string[] = [];
    const blockedSources: string[] = [];
    const omissionReport: ContextOmissionReport[] = [];
    let decision: ContextBudgetDecision = 'allow';
    let criticalIncludedChars = 0;
    let previewIncludedChars = 0;
    let usedChars = basePrompt.length;

    for (const source of ordered) {
      const originalChars = source.content.length;
      const critical = source.critical === true;
      const prefix = `[${source.label}${source.path ? ` — ${source.path}` : ''}]\n`;
      const suffix = `\n[/${source.label}]`;
      const overhead = prefix.length + suffix.length + delimiter.length;
      const remaining = maxChars - usedChars - overhead;

      if (remaining <= 0) {
        const reason: ContextOmissionReason = critical ? 'critical-evidence-exceeds-budget' : 'context-budget-exhausted';
        if (critical) {
          blockedSources.push(source.id);
          decision = 'blocked';
        } else if (decision !== 'blocked') {
          decision = 'replan';
        }
        omittedSources.push(source.id);
        omissionReport.push(toOmissionReport(source, reason, 0));
        reports.push(toReport(source, originalChars, 0, false, true, 'omitted', reason));
        continue;
      }

      const truncationMarker = '\n\n[上下文已截断]';
      const canTruncate = source.canTruncate !== false && !critical;
      if (source.content.length > remaining && !canTruncate) {
        const reason: ContextOmissionReason = critical
          ? 'critical-evidence-exceeds-budget'
          : 'nontruncatable-source-exceeds-budget';
        if (critical) {
          blockedSources.push(source.id);
          decision = 'blocked';
        } else if (decision !== 'blocked') {
          decision = 'replan';
        }
        omittedSources.push(source.id);
        omissionReport.push(toOmissionReport(source, reason, 0));
        reports.push(toReport(source, originalChars, 0, false, true, 'omitted', reason));
        continue;
      }

      const includedContent = source.content.length > remaining
        ? `${source.content.slice(0, Math.max(0, remaining - truncationMarker.length))}${truncationMarker}`
        : source.content;
      const truncated = includedContent.length !== source.content.length;
      const section = `${prefix}${includedContent}${suffix}`;
      sections.push(section);
      usedChars += section.length + delimiter.length;
      includedSources.push(source.id);
      if (critical) criticalIncludedChars += includedContent.length;
      if (truncated) {
        truncatedSources.push(source.id);
        previewIncludedChars += includedContent.length;
        omissionReport.push(toOmissionReport(source, 'preview-truncated-for-budget', includedContent.length));
        if (decision !== 'blocked') decision = 'replan';
      }
      reports.push(toReport(
        source,
        originalChars,
        includedContent.length,
        truncated,
        false,
        truncated ? 'preview' : 'full',
        truncated ? 'preview-truncated-for-budget' : undefined,
      ));
    }

    const prompt = sections.length > 0
      ? `${sections.join(delimiter)}${delimiter}${basePrompt}`
      : basePrompt;
    const promptUsedChars = prompt.length;
    const remainingChars = Math.max(0, maxChars - promptUsedChars);
    const omittedChars = omissionReport.reduce((sum, item) => sum + item.omittedChars, 0);

    return {
      prompt,
      sources: reports,
      budget: {
        version: CONTEXT_BUDGET_PROTOCOL_VERSION,
        decision,
        replanRequired: decision !== 'allow',
        maxChars,
        usedChars: promptUsedChars,
        remainingChars,
        includedSources,
        truncatedSources,
        omittedSources,
        blockedSources,
        omissionReport,
        usageBudget: {
          maxChars,
          usedChars: promptUsedChars,
          remainingChars,
          criticalIncludedChars,
          previewIncludedChars,
          omittedChars,
        },
      },
    };
  }
}

function toReport(
  source: ContextSource,
  originalChars: number,
  includedChars: number,
  truncated: boolean,
  omitted: boolean,
  sourceIntegrity: ContextSourceReport['sourceIntegrity'],
  omissionReason?: ContextOmissionReason,
): ContextSourceReport {
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    path: source.path,
    originalChars,
    includedChars,
    truncated,
    omitted,
    critical: source.critical === true,
    sourceIntegrity,
    ...(omissionReason ? { omissionReason } : {}),
  };
}

function toOmissionReport(
  source: ContextSource,
  reason: ContextOmissionReason,
  includedChars: number,
): ContextOmissionReport {
  const originalChars = source.content.length;
  return {
    id: source.id,
    reason,
    critical: source.critical === true,
    originalChars,
    includedChars,
    omittedChars: Math.max(0, originalChars - includedChars),
  };
}
