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

// src/response-extractor.ts
var response_extractor_exports = {};
__export(response_extractor_exports, {
  extractDeepSeekResponse: () => extractDeepSeekResponse,
  isLoginUrl: () => isLoginUrl,
  normalizeDeepSeekAnswer: () => normalizeDeepSeekAnswer
});
module.exports = __toCommonJS(response_extractor_exports);
function isLoginUrl(url) {
  return /sign[_-]?in|login|auth|register/i.test(url);
}
function normalizeDeepSeekAnswer(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function extractDeepSeekResponse(snapshot) {
  const lastAnswer = [...snapshot.assistantMessages].reverse().map(normalizeDeepSeekAnswer).find(Boolean) || "";
  const errorText = (snapshot.errorTexts || []).map(normalizeDeepSeekAnswer).find(Boolean) || "";
  const isLoggedIn = Boolean(snapshot.loggedInIndicatorCount && snapshot.loggedInIndicatorCount > 0) && !isLoginUrl(snapshot.url || "");
  return { lastAnswer, errorText, isLoggedIn };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  extractDeepSeekResponse,
  isLoginUrl,
  normalizeDeepSeekAnswer
});
