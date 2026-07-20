"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/bridge-health-check.ts
var bridge_health_check_exports = {};
__export(bridge_health_check_exports, {
  DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION: () => DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION,
  buildDeepSeekDomFingerprint: () => buildDeepSeekDomFingerprint,
  checkBridgeHealth: () => checkBridgeHealth
});
module.exports = __toCommonJS(bridge_health_check_exports);

// src/response-extractor.ts
function isLoginUrl(url) {
  return /sign[_-]?in|login|auth|register/i.test(url);
}

// src/bridge-health-check.ts
var DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION = "devseek.deepseek-web-connector-health/v1";
var DEEPSEEK_DOM_MISSING_REASON_CODES = {
  chatInput: "deepseek-dom-chat-input-missing",
  sendButton: "deepseek-dom-send-button-missing"
};
function checkBridgeHealth(snapshot, pageSnapshotOrLoggedInIndicatorCount = 0) {
  const pageSnapshot = normalizePageSnapshot(snapshot, pageSnapshotOrLoggedInIndicatorCount);
  const legacyIndicatorOnly = typeof pageSnapshotOrLoggedInIndicatorCount === "number";
  const pageKind = classifyPageKind(snapshot, pageSnapshot);
  const domFingerprint = buildDeepSeekDomFingerprint(pageKind, pageSnapshot.selectorCounts);
  if (!snapshot.hasBrowser || !snapshot.hasContext || !snapshot.hasPage || snapshot.pageClosed) {
    return health(snapshot, domFingerprint, false, false, "browser-session-not-ready");
  }
  if (isLoginUrl(pageSnapshot.url || snapshot.url || "")) {
    return health(snapshot, domFingerprint, true, false, "login-url");
  }
  if (legacyIndicatorOnly) {
    return health(
      snapshot,
      domFingerprint,
      true,
      (pageSnapshot.loggedInIndicatorCount ?? 0) > 0,
      (pageSnapshot.loggedInIndicatorCount ?? 0) > 0 ? "logged-in-indicator-present" : "logged-in-indicator-missing"
    );
  }
  if ((pageSnapshot.loggedInIndicatorCount ?? 0) <= 0) {
    return health(snapshot, domFingerprint, true, false, "logged-in-indicator-missing");
  }
  if (domFingerprint.missingRequired.length > 0) {
    const missing = domFingerprint.missingRequired[0];
    return health(snapshot, domFingerprint, true, false, deepSeekDomMissingReason(missing));
  }
  return health(snapshot, domFingerprint, true, true, "deepseek-dom-ready");
}
function deepSeekDomMissingReason(group) {
  return DEEPSEEK_DOM_MISSING_REASON_CODES[group] ?? `deepseek-dom-${group.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}-missing`;
}
function buildDeepSeekDomFingerprint(pageKind, selectorCounts = {}) {
  const stableSelectorCounts = {
    loggedInIndicator: selectorCounts.loggedInIndicator ?? 0,
    chatInput: selectorCounts.chatInput ?? 0,
    sendButton: selectorCounts.sendButton ?? 0,
    assistantMessage: selectorCounts.assistantMessage ?? 0
  };
  const missingRequired = pageKind === "chat" ? ["chatInput", "sendButton"].filter((group) => (stableSelectorCounts[group] ?? 0) <= 0) : [];
  return {
    protocolVersion: DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION,
    pageKind,
    selectorCounts: stableSelectorCounts,
    missingRequired,
    evidenceRefs: [
      `deepseek-page:${pageKind}`,
      ...missingRequired.map((group) => `deepseek-dom:missing:${group}`)
    ]
  };
}
function normalizePageSnapshot(snapshot, value) {
  if (typeof value === "number") {
    return {
      loggedInIndicatorCount: value,
      selectorCounts: {
        loggedInIndicator: value
      },
      url: snapshot.url
    };
  }
  const selectorCounts = value.selectorCounts ?? {};
  return {
    loggedInIndicatorCount: value.loggedInIndicatorCount ?? selectorCounts.loggedInIndicator ?? 0,
    selectorCounts,
    url: value.url ?? snapshot.url
  };
}
function classifyPageKind(session, snapshot) {
  if (!session.hasBrowser || !session.hasContext || !session.hasPage || session.pageClosed) return "session-missing";
  const url = snapshot.url || session.url || "";
  if (isLoginUrl(url)) return "login";
  const counts = snapshot.selectorCounts ?? {};
  if ((snapshot.loggedInIndicatorCount ?? 0) > 0 || (counts.chatInput ?? 0) > 0 || (counts.sendButton ?? 0) > 0 || (counts.assistantMessage ?? 0) > 0) return "chat";
  return "unknown";
}
function health(session, domFingerprint, browserReady, loggedInLikely, reason) {
  return {
    protocolVersion: DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION,
    browserReady,
    loggedInLikely,
    reason,
    pageKind: domFingerprint.pageKind,
    session,
    domFingerprint
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEEPSEEK_WEB_CONNECTOR_HEALTH_PROTOCOL_VERSION,
  buildDeepSeekDomFingerprint,
  checkBridgeHealth
});
