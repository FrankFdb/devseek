const LOGIN_LINE_RE = /^(?:error\s*[:：]\s*)?(?:LOGIN_REQUIRED|请先?登录(?:后继续)?|请重新登录|重新登录(?:后继续)?|登录(?:已)?失效|会话(?:已)?过期|login required|session expired|authentication required|not authenticated|(?:please\s+)?(?:sign|log)[-\s]?in(?:\s+(?:required|to continue))?)(?:[。.!！])?$/i;
const VERIFICATION_LINE_RE = /^(?:(?:请|需要|必须)?(?:完成|通过|进行)?(?:人机|安全|身份|真人|滑块)?验证(?:码)?(?:后继续)?|请输入验证码(?:完成|通过|进行)?(?:人机|安全|身份|真人|滑块)?验证|verify you are human|complete captcha|captcha required)(?:[。.!！])?$/i;
const RATE_LIMIT_LINE_RE = /^(?:error\s*[:：]\s*)?(?:rate[-_ ]?limit(?:ed|ing)?|too many requests|HTTP\s*429(?:\s+too many requests)?|429\s+too many requests|当前请求已被限流|请求(?:过于|太)频繁|访问频率(?:过高|太高)|当前访问人数较多|请求达到上限|使用量达到上限|正在排队|排队中|系统繁忙|服务繁忙|请稍后再试|service busy|waiting for verification)(?:[，,。.!！：:]\s*[^\n]{0,120})?$/i;
const ERROR_LINE_RE = /^(?:bad gateway|service unavailable|gateway timeout|application error|something went wrong|页面加载失败|网络错误|请求失败|ERR_[A-Z_]+|HTTP\s*(?:4\d\d|5\d\d))(?:[：:]?\s*[^\n]{0,160})?$/i;

export function looksLikeProviderLoginGate(text: string): boolean {
  const normalized = normalizeSurfaceText(text);
  if (!normalized) return false;
  if (looksLikeHtmlSurface(normalized)) {
    return /(?:\blogin\b|sign[-\s]?in|log[-\s]?in|请先?登录|重新登录|会话(?:已)?过期)/i.test(stripHtml(normalized));
  }
  const control = parseControlPayload(normalized);
  if (control) return containsControlValue(control, ['LOGIN_REQUIRED', 'login-required']);
  return isBoundedControlLine(normalized, LOGIN_LINE_RE);
}

export function looksLikeProviderVerificationGate(text: string): boolean {
  const normalized = normalizeSurfaceText(text);
  if (!normalized) return false;
  if (looksLikeHtmlSurface(normalized)) {
    return /(?:captcha|人机验证|安全验证|身份验证|真人验证|滑块验证|验证码|verify you are human)/i.test(stripHtml(normalized));
  }
  const control = parseControlPayload(normalized);
  if (control) return containsControlValue(control, ['captcha', 'verification-required']);
  return isBoundedControlLine(normalized, VERIFICATION_LINE_RE);
}

export function looksLikeProviderRateLimitGate(text: string): boolean {
  const normalized = normalizeSurfaceText(text);
  if (!normalized) return false;
  if (looksLikeHtmlSurface(normalized)) {
    return /(?:\b429\b|rate[-_ ]?limit|too many requests|请求(?:过于|太)频繁|限流|系统繁忙|服务繁忙)/i.test(stripHtml(normalized));
  }
  const control = parseControlPayload(normalized);
  if (control) return containsControlValue(control, ['RATE_LIMITED', 'rate-limited', '429']);
  return isBoundedControlLine(normalized, RATE_LIMIT_LINE_RE);
}

export function looksLikeProviderErrorSurface(text: string): boolean {
  const normalized = normalizeSurfaceText(text);
  if (!normalized) return false;
  if (looksLikeHtmlSurface(normalized)) {
    return /(?:bad gateway|service unavailable|gateway timeout|application error|something went wrong|页面加载失败|网络错误|请求失败|ERR_[A-Z_]+|HTTP\s*(?:4\d\d|5\d\d)|cloudflare)/i.test(stripHtml(normalized));
  }
  const control = parseControlPayload(normalized);
  if (control) return containsProviderErrorControl(control);
  return isBoundedControlLine(normalized, ERROR_LINE_RE);
}

function normalizeSurfaceText(text: string): string {
  return String(text || '').replace(/\u00a0/g, ' ').trim();
}

function isBoundedControlLine(text: string, pattern: RegExp): boolean {
  return text.length <= 320 && !/[\r\n]/.test(text) && pattern.test(text);
}

function looksLikeHtmlSurface(text: string): boolean {
  return /<html[\s>]/i.test(text) || /<!doctype html/i.test(text) || /<title[\s>]/i.test(text);
}

function stripHtml(text: string): string {
  return text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseControlPayload(text: string): unknown | undefined {
  if (text.length > 2000 || !/^(?:\{|\[)/.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function containsControlValue(value: unknown, expected: readonly string[]): boolean {
  if (typeof value === 'string') return expected.includes(value);
  if (typeof value === 'number') return expected.includes(String(value));
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => containsControlValue(item, expected));
  const record = value as Record<string, unknown>;
  return ['error', 'code', 'reason', 'errorCategory', 'status']
    .some(key => containsControlValue(record[key], expected));
}

function containsProviderErrorControl(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsProviderErrorControl);
  const record = value as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  if (typeof status === 'number' && status >= 400 && status <= 599) return true;
  const code = record.error ?? record.code ?? record.reason;
  return typeof code === 'string' && /^(?:PROVIDER_ERROR|HTTP_[45]\d\d|ERR_[A-Z_]+)$/.test(code);
}
