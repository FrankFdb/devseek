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
  checkBridgeHealth: () => checkBridgeHealth
});
module.exports = __toCommonJS(bridge_health_check_exports);

// src/response-extractor.ts
function isLoginUrl(url) {
  return /sign[_-]?in|login|auth|register/i.test(url);
}

// src/bridge-health-check.ts
function checkBridgeHealth(snapshot, loggedInIndicatorCount = 0) {
  if (!snapshot.hasBrowser || !snapshot.hasContext || !snapshot.hasPage) {
    return { browserReady: false, loggedInLikely: false, reason: "browser-session-not-ready" };
  }
  if (isLoginUrl(snapshot.url || "")) {
    return { browserReady: true, loggedInLikely: false, reason: "login-url" };
  }
  return {
    browserReady: true,
    loggedInLikely: loggedInIndicatorCount > 0,
    reason: loggedInIndicatorCount > 0 ? "logged-in-indicator-present" : "logged-in-indicator-missing"
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkBridgeHealth
});
