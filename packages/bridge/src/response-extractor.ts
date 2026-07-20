export interface DeepSeekResponseSnapshot {
  assistantMessages: string[];
  errorTexts?: string[];
  loggedInIndicatorCount?: number;
  selectorCounts?: Record<string, number>;
  url?: string;
}

export interface DeepSeekResponseExtraction {
  lastAnswer: string;
  errorText: string;
  isLoggedIn: boolean;
}

export function isLoginUrl(url: string): boolean {
  return /sign[_-]?in|login|auth|register/i.test(url);
}

export function normalizeDeepSeekAnswer(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractDeepSeekResponse(snapshot: DeepSeekResponseSnapshot): DeepSeekResponseExtraction {
  const lastAnswer = [...snapshot.assistantMessages]
    .reverse()
    .map(normalizeDeepSeekAnswer)
    .find(Boolean) || '';

  const errorText = (snapshot.errorTexts || [])
    .map(normalizeDeepSeekAnswer)
    .find(Boolean) || '';

  const isLoggedIn = Boolean(snapshot.loggedInIndicatorCount && snapshot.loggedInIndicatorCount > 0)
    && !isLoginUrl(snapshot.url || '');

  return { lastAnswer, errorText, isLoggedIn };
}
