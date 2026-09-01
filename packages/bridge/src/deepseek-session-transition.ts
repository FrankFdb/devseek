export const DEEPSEEK_SESSION_TRANSITION_ERROR_CODE = 'DEEPSEEK_SESSION_TRANSITION_FAILED';
export const DEEPSEEK_SESSION_NAVIGATION_TIMEOUT_MS = 12_000;
export const DEEPSEEK_SESSION_INPUT_TIMEOUT_MS = 10_000;
const DEEPSEEK_SESSION_CLICK_SETTLE_MS = 300;

export interface DeepSeekSessionTransitionButton {
  click(): Promise<unknown>;
}

export interface DeepSeekSessionTransitionPort {
  findNewChatButton(): Promise<DeepSeekSessionTransitionButton | null>;
  navigateHome(options: { readonly waitUntil: 'commit'; readonly timeout: number }): Promise<unknown>;
  waitForChatInput(timeoutMs: number): Promise<unknown>;
  waitForTimeout(timeoutMs: number): Promise<unknown>;
}

export interface DeepSeekSessionTransitionResult {
  readonly mechanism: 'new-chat-button' | 'home-navigation';
  readonly clickFailure?: string;
}

export class DeepSeekSessionTransitionError extends Error {
  constructor(
    readonly stage: 'navigation' | 'readiness',
    readonly originalError: unknown,
    readonly clickFailure?: string,
  ) {
    const detail = errorMessage(originalError);
    const fallback = clickFailure ? `; click-fallback=${clickFailure}` : '';
    super(`${DEEPSEEK_SESSION_TRANSITION_ERROR_CODE}:${stage}:${detail}${fallback}`);
    this.name = 'DeepSeekSessionTransitionError';
  }
}

/** Starts one clean DeepSeek Web conversation with a bounded, proven transition. */
export async function startDeepSeekSession(
  port: DeepSeekSessionTransitionPort,
): Promise<DeepSeekSessionTransitionResult> {
  let clickFailure: string | undefined;
  const button = await port.findNewChatButton().catch(error => {
    clickFailure = errorMessage(error);
    return null;
  });

  if (button) {
    try {
      await button.click();
      await port.waitForTimeout(DEEPSEEK_SESSION_CLICK_SETTLE_MS);
      await port.waitForChatInput(DEEPSEEK_SESSION_INPUT_TIMEOUT_MS);
      return Object.freeze({ mechanism: 'new-chat-button' });
    } catch (error) {
      clickFailure = errorMessage(error);
    }
  }

  try {
    await port.navigateHome({
      waitUntil: 'commit',
      timeout: DEEPSEEK_SESSION_NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    throw new DeepSeekSessionTransitionError('navigation', error, clickFailure);
  }

  try {
    await port.waitForChatInput(DEEPSEEK_SESSION_INPUT_TIMEOUT_MS);
  } catch (error) {
    throw new DeepSeekSessionTransitionError('readiness', error, clickFailure);
  }
  return Object.freeze({
    mechanism: 'home-navigation',
    ...(clickFailure ? { clickFailure } : {}),
  });
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  const message = (error as { readonly message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? message.trim() : 'unknown-error';
}
