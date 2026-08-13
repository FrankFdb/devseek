import {
  AutoApplyPolicy,
  ChatIntentDecision,
  decideChatIntent,
} from '../intent-router';
import type { SemanticIntentInterpretation } from '../intent/semantic-intent';
import { governSemanticIntent } from '../intent/semantic-intent-governor';
import type { TaskSemanticResolutionContext } from '../intent/task-semantic-contract-service';
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
  semanticContext?: TaskSemanticResolutionContext;
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
    const semanticContext = input.semanticIntent
      ? { ...(input.semanticContext ?? {}), semanticIntent: input.semanticIntent }
      : input.semanticContext;
    let intent = decideChatIntent(intentRoutingText, semanticContext);
    intent = governSemanticIntent(intent, input.semanticIntent);

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
