import {
  ChatIntentDecision,
  decideChatIntent,
} from '../intent-router';
import { buildToolPolicy, ToolPolicy } from './permission-service';
import { selectWorkflow, WorkflowSelection } from './workflow-service';

export interface ChatRouteInput {
  userDisplay: string;
  prompt: string;
  files: string[];
  agentEnabled: boolean;
  forceNoAgent?: boolean;
  intentConfirmed?: boolean;
}

export interface ChatRouteDecision {
  intentRoutingText: string;
  intent: ChatIntentDecision;
  toolPolicy: ToolPolicy;
  workflow: WorkflowSelection;
}

export class ChatRouteController {
  decide(input: ChatRouteInput): ChatRouteDecision {
    const intentRoutingText = getIntentRoutingText(input.userDisplay, input.prompt);
    const intent = decideChatIntent(intentRoutingText);

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
    };
  }
}

export function getIntentRoutingText(userDisplay: string, prompt: string): string {
  const display = userDisplay || '';
  if (!display.trim()) return prompt;

  const lines = display.split(/\r?\n/);
  const withoutAttachmentBadges = lines.filter(line => !/^\s*📎\s*`[^`]+`\s*$/.test(line));
  if (withoutAttachmentBadges.length === lines.length) return display;

  while (withoutAttachmentBadges[0]?.trim() === '') withoutAttachmentBadges.shift();
  while (withoutAttachmentBadges.at(-1)?.trim() === '') withoutAttachmentBadges.pop();
  return withoutAttachmentBadges.join('\n') || display;
}
