import type { BrowserSessionSnapshot } from './browser-session';
import { isLoginUrl } from './response-extractor';
import type { DeepSeekResponseSnapshot } from './response-extractor';

export const DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION = 'devseek.deepseek-web-connector-health/v1';

export type DeepSeekPageKind = 'session-missing' | 'login' | 'chat' | 'unknown';

export interface DeepSeekDomFingerprint {
  protocolVersion: typeof DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION;
  pageKind: DeepSeekPageKind;
  selectorCounts: Record<string, number>;
  missingRequired: string[];
  evidenceRefs: string[];
}

export interface BridgeHealth {
  protocolVersion: typeof DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION;
  browserReady: boolean;
  loggedInLikely: boolean;
  reason: string;
  pageKind: DeepSeekPageKind;
  session: BrowserSessionSnapshot;
  domFingerprint: DeepSeekDomFingerprint;
}

const DEEPSEEK_DOM_MISSING_REASON_CODES: Record<string, string> = {
  chatInput: 'deepseek-dom-chat-input-missing',
  sendButton: 'deepseek-dom-send-button-missing',
};

export function checkBridgeHealth(
  snapshot: BrowserSessionSnapshot,
  pageSnapshotOrLoggedInIndicatorCount: DeepSeekResponseSnapshot | number = 0,
): BridgeHealth {
  const pageSnapshot = normalizePageSnapshot(snapshot, pageSnapshotOrLoggedInIndicatorCount);
  const legacyIndicatorOnly = typeof pageSnapshotOrLoggedInIndicatorCount === 'number';
  const pageKind = classifyPageKind(snapshot, pageSnapshot);
  const domFingerprint = buildDeepSeekDomFingerprint(pageKind, pageSnapshot.selectorCounts);

  if (!snapshot.hasBrowser || !snapshot.hasContext || !snapshot.hasPage || snapshot.pageClosed) {
    return health(snapshot, domFingerprint, false, false, 'browser-session-not-ready');
  }
  if (isLoginUrl(pageSnapshot.url || snapshot.url || '')) {
    return health(snapshot, domFingerprint, true, false, 'login-url');
  }
  if (legacyIndicatorOnly) {
    return health(
      snapshot,
      domFingerprint,
      true,
      (pageSnapshot.loggedInIndicatorCount ?? 0) > 0,
      (pageSnapshot.loggedInIndicatorCount ?? 0) > 0 ? 'logged-in-indicator-present' : 'logged-in-indicator-missing',
    );
  }
  if ((pageSnapshot.loggedInIndicatorCount ?? 0) <= 0) {
    return health(snapshot, domFingerprint, true, false, 'logged-in-indicator-missing');
  }
  if (domFingerprint.missingRequired.length > 0) {
    const missing = domFingerprint.missingRequired[0];
    return health(snapshot, domFingerprint, true, false, deepSeekDomMissingReason(missing));
  }
  return health(snapshot, domFingerprint, true, true, 'deepseek-dom-ready');
}

function deepSeekDomMissingReason(group: string): string {
  return DEEPSEEK_DOM_MISSING_REASON_CODES[group]
    ?? `deepseek-dom-${group.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}-missing`;
}

export function buildDeepSeekDomFingerprint(
  pageKind: DeepSeekPageKind,
  selectorCounts: Record<string, number> = {},
): DeepSeekDomFingerprint {
  const stableSelectorCounts: Record<string, number> = {
    loggedInIndicator: selectorCounts.loggedInIndicator ?? 0,
    chatInput: selectorCounts.chatInput ?? 0,
    sendButton: selectorCounts.sendButton ?? 0,
    assistantMessage: selectorCounts.assistantMessage ?? 0,
  };
  const missingRequired = pageKind === 'chat'
    ? ['chatInput', 'sendButton'].filter((group) => (stableSelectorCounts[group] ?? 0) <= 0)
    : [];
  return {
    protocolVersion: DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION,
    pageKind,
    selectorCounts: stableSelectorCounts,
    missingRequired,
    evidenceRefs: [
      `deepseek-page:${pageKind}`,
      ...missingRequired.map((group) => `deepseek-dom:missing:${group}`),
    ],
  };
}

function normalizePageSnapshot(
  snapshot: BrowserSessionSnapshot,
  value: DeepSeekResponseSnapshot | number,
): Pick<DeepSeekResponseSnapshot, 'loggedInIndicatorCount' | 'selectorCounts' | 'url'> {
  if (typeof value === 'number') {
    return {
      loggedInIndicatorCount: value,
      selectorCounts: {
        loggedInIndicator: value,
      },
      url: snapshot.url,
    };
  }
  const selectorCounts = value.selectorCounts ?? {};
  return {
    loggedInIndicatorCount: value.loggedInIndicatorCount ?? selectorCounts.loggedInIndicator ?? 0,
    selectorCounts,
    url: value.url ?? snapshot.url,
  };
}

function classifyPageKind(
  session: BrowserSessionSnapshot,
  snapshot: Pick<DeepSeekResponseSnapshot, 'loggedInIndicatorCount' | 'selectorCounts' | 'url'>,
): DeepSeekPageKind {
  if (!session.hasBrowser || !session.hasContext || !session.hasPage || session.pageClosed) return 'session-missing';
  const url = snapshot.url || session.url || '';
  if (isLoginUrl(url)) return 'login';
  const counts = snapshot.selectorCounts ?? {};
  if (
    (snapshot.loggedInIndicatorCount ?? 0) > 0
    || (counts.chatInput ?? 0) > 0
    || (counts.sendButton ?? 0) > 0
    || (counts.assistantMessage ?? 0) > 0
  ) return 'chat';
  return 'unknown';
}

function health(
  session: BrowserSessionSnapshot,
  domFingerprint: DeepSeekDomFingerprint,
  browserReady: boolean,
  loggedInLikely: boolean,
  reason: string,
): BridgeHealth {
  return {
    protocolVersion: DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION,
    browserReady,
    loggedInLikely,
    reason,
    pageKind: domFingerprint.pageKind,
    session,
    domFingerprint,
  };
}
