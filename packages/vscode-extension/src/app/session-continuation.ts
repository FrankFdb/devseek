export const CHECKPOINT_RESUME_COMMAND = '/resume-checkpoint';

export interface CheckpointResumeCommandInput {
  userDisplay: string;
  prompt: string;
  newSession?: boolean;
  resumeFromIndex?: number;
}

/**
 * Resolves one explicit UI protocol command. Natural-language follow-ups are
 * ordinary model input and never select a persisted checkpoint locally.
 */
export function shouldResumeCheckpointFromCommand(input: CheckpointResumeCommandInput): boolean {
  return input.resumeFromIndex === undefined
    && !input.newSession
    && isCheckpointResumeCommand(input.userDisplay || input.prompt);
}

export function isCheckpointResumeCommand(text: string): boolean {
  return String(text || '').trim() === CHECKPOINT_RESUME_COMMAND;
}

export function appendSessionContinuationContext(prompt: string, context: string): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return prompt;
  return `${prompt}\n\n【同一会话有界历史（非执行授权）】\n${trimmedContext}`;
}
