import type { BrowserSessionSnapshot } from './browser-session';
import { isLoginUrl } from './response-extractor';

export interface BridgeHealth {
  browserReady: boolean;
  loggedInLikely: boolean;
  reason: string;
}

export function checkBridgeHealth(
  snapshot: BrowserSessionSnapshot,
  loggedInIndicatorCount = 0,
): BridgeHealth {
  if (!snapshot.hasBrowser || !snapshot.hasContext || !snapshot.hasPage) {
    return { browserReady: false, loggedInLikely: false, reason: 'browser-session-not-ready' };
  }
  if (isLoginUrl(snapshot.url || '')) {
    return { browserReady: true, loggedInLikely: false, reason: 'login-url' };
  }
  return {
    browserReady: true,
    loggedInLikely: loggedInIndicatorCount > 0,
    reason: loggedInIndicatorCount > 0 ? 'logged-in-indicator-present' : 'logged-in-indicator-missing',
  };
}
