import {
  AutoApplyPolicy,
  ChatIntentDecision,
  decideChatIntent,
} from '../intent-router';
import type { ExecutionMode, ToolKind } from '../intent/intent-types';
import type { SemanticIntentInterpretation } from '../intent/semantic-intent';
import { buildToolPolicy, ToolPolicy } from './permission-service';
import { selectWorkflow, WorkflowSelection } from './workflow-service';

export interface ChatRouteInput {
  userDisplay: string;
  prompt: string;
  files: string[];
  agentEnabled: boolean;
  forceNoAgent?: boolean;
  intentConfirmed?: boolean;
  lookupLearnedIntent?: (text: string) => 'chat' | 'code-change' | null;
  semanticIntent?: SemanticIntentInterpretation;
  autoApplyPolicy?: AutoApplyPolicy;
}

export interface ChatRouteDecision {
  intentRoutingText: string;
  intent: ChatIntentDecision;
  toolPolicy: ToolPolicy;
  workflow: WorkflowSelection;
  autoApplyPolicy: AutoApplyPolicy;
}

export class ChatRouteController {
  decide(input: ChatRouteInput): ChatRouteDecision {
    const intentRoutingText = getIntentRoutingText(input.userDisplay, input.prompt);
    let intent = decideChatIntent(intentRoutingText);
    intent = applySemanticIntentSafely(intent, input.semanticIntent);

    const learnedKind = input.lookupLearnedIntent?.(intentRoutingText) ?? null;
    if (learnedKind !== null) {
      intent = applyLearnedIntentSafely(intent, learnedKind);
    }

    const workflow = selectWorkflow({
      intent,
      files: input.files,
      agentEnabled: input.agentEnabled,
      forceNoAgent: input.forceNoAgent,
      intentConfirmed: input.intentConfirmed,
      prompt: input.prompt,
      userText: intentRoutingText,
    });
    const toolPolicy = buildToolPolicy(workflow.toolPolicyMode);

    return {
      intentRoutingText,
      intent,
      toolPolicy,
      workflow,
      autoApplyPolicy: input.autoApplyPolicy ?? 'conservative',
    };
  }
}

function applySemanticIntentSafely(
  intent: ChatIntentDecision,
  semanticIntent: SemanticIntentInterpretation | undefined,
): ChatIntentDecision {
  if (!semanticIntent || semanticIntent.confidence < 0.62) return intent;

  if (isHardLocalBoundary(intent)) {
    return {
      ...intent,
      signals: ['semantic-intent-constrained', ...intent.signals],
    };
  }

  const requestedMode = governedSemanticMode(semanticIntent);
  const localNoChange = intent.blockers.includes('explicit-no-change');
  const noChangeCompatibleRunOnly = requestedMode === 'run' && semanticIntent.mutation === 'run-only';
  const nextMode = localNoChange && isMutatingMode(requestedMode) && !noChangeCompatibleRunOnly
    ? intent.mode
    : requestedMode;
  const nextKind = chatKindForMode(nextMode);
  const nextAllowedToolKinds = allowedToolKindsForMode(nextMode);
  const overridden = nextMode !== intent.mode || nextKind !== intent.kind;
  const externalEffect = semanticIntent.requiresExternalEffect || semanticIntent.mutation === 'external-effect';

  return {
    ...intent,
    kind: nextKind,
    mode: nextMode,
    addStructuredHint: nextKind === 'code-change',
    autoApplyEligible: nextMode === 'edit',
    confidence: Math.max(intent.confidence, semanticIntent.confidence),
    score: overridden ? Math.max(intent.score, 4) : intent.score,
    signals: [
      'semantic-intent-provider',
      `semantic-task:${semanticIntent.taskKind}`,
      `semantic-mutation:${semanticIntent.mutation}`,
      ...(overridden ? ['semantic-intent-overrode-local'] : []),
      ...(semanticIntent.requiresClarification ? ['semantic-clarification-needed'] : []),
      ...intent.signals,
    ],
    blockers: [
      ...(semanticIntent.requiresClarification ? ['semantic-clarification-needed'] : []),
      ...(noChangeCompatibleRunOnly
        ? intent.blockers.filter(blocker => blocker !== 'explicit-no-change')
        : intent.blockers),
    ],
    reason: `semantic:${semanticIntent.taskKind}:${semanticIntent.reason || intent.reason}`,
    requiresConfirmation: intent.requiresConfirmation
      || nextMode === 'destructive'
      || externalEffect,
    allowedToolKinds: nextAllowedToolKinds,
  };
}

function isHardLocalBoundary(intent: ChatIntentDecision): boolean {
  return intent.blockers.includes('empty-prompt')
    || intent.requiresConfirmation
    || intent.mode === 'smalltalk'
    || intent.mode === 'destructive';
}

function isMutatingMode(mode: ExecutionMode): boolean {
  return mode === 'edit' || mode === 'run' || mode === 'destructive';
}

function governedSemanticMode(semanticIntent: SemanticIntentInterpretation): ExecutionMode {
  if (semanticIntent.mutation !== 'none') return semanticIntent.mode;
  if (!isMutatingMode(semanticIntent.mode)) return semanticIntent.mode;
  return semanticIntent.taskKind === 'planning' ? 'plan' : 'inspect';
}

function chatKindForMode(mode: ExecutionMode): 'chat' | 'code-change' {
  return isMutatingMode(mode) ? 'code-change' : 'chat';
}

function allowedToolKindsForMode(mode: ExecutionMode): ToolKind[] {
  switch (mode) {
    case 'inspect':
      return ['read', 'search', 'diagnostics', 'network', 'control'];
    case 'plan':
      return ['read', 'search', 'diagnostics', 'network', 'control', 'plan', 'memory'];
    case 'edit':
      return ['read', 'search', 'diagnostics', 'network', 'control', 'plan', 'memory', 'edit', 'terminal'];
    case 'run':
      return ['read', 'search', 'diagnostics', 'network', 'control', 'plan', 'memory', 'terminal'];
    case 'destructive':
      return ['read', 'search', 'diagnostics', 'network', 'control', 'plan', 'memory', 'edit', 'terminal', 'vscode', 'vscode-command', 'mcp'];
    case 'smalltalk':
    case 'qa':
    default:
      return [];
  }
}

export function getIntentRoutingText(userDisplay: string, prompt: string): string {
  const display = (userDisplay || '').trim();
  if (!display) return prompt;

  const withoutAttachmentBadges = display
    .split(/\r?\n/)
    .filter(line => !/^\s*📎\s*`[^`]+`\s*$/.test(line.trim()))
    .join('\n')
    .trim();

  return withoutAttachmentBadges || display;
}

function applyLearnedIntentSafely(
  intent: ChatIntentDecision,
  learnedKind: 'chat' | 'code-change',
): ChatIntentDecision {
  if (learnedKind === intent.kind) {
    return { ...intent, signals: ['learned-habit', ...intent.signals] };
  }

  return {
    ...intent,
    signals: ['learned-habit-ignored', ...intent.signals],
    blockers: ['learned-habit-conflict', ...intent.blockers],
  };
}
