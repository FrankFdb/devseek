const PROVIDER_RATE_LIMIT_RE = /(?:\brate[-_ ]?limit(?:ed|ing)?\b|too many requests|HTTP\s*429|429\s+too many requests|请求(?:过于|太)频繁|访问频率(?:过高|太高)|当前访问人数较多|请求达到上限|使用量达到上限|排队(?:中|等待)|(?:触发|受到|遭遇|进入|已被?|被)限流|限流(?:中|保护|限制|状态)|(?:^|[\n:：])\s*限流(?:[，,。.!！：:]|$)|(?:服务|系统)繁忙(?:[，,。.!！]|$)|请?稍后再试|service busy|waiting for verification)/i;
const PROVIDER_RATE_LIMIT_HTML_RE = new RegExp(`${PROVIDER_RATE_LIMIT_RE.source}|\\b429\\b`, 'i');

export function looksLikeProviderLoginGate(text: string): boolean {
  const normalized = normalizeSurfaceText(text);
  if (!normalized) return false;
  if (looksLikeProviderLoginRequiredSentinel(normalized)) return true;
  if (looksLikeHtmlSurface(normalized)) {
    return /(?:请先?登录|重新登录|登录(?:已)?失效|会话(?:已)?过期|登录后继续|sign[-\s]+in|log[-\s]+in|login required|session expired|authentication required|not authenticated|\blogin\b)/i.test(stripHtml(normalized));
  }
  if (!looksLikeProviderControlText(normalized)) return false;
  return /(?:请先?登录|重新登录|登录(?:已)?失效|会话(?:已)?过期|登录后继续|sign[-\s]+in|log[-\s]+in|login required|session expired|authentication required|not authenticated)/i.test(normalized);
}

export function looksLikeProviderVerificationGate(text: string): boolean {
  const normalized = normalizeSurfaceText(text);
  if (!normalized) return false;
  if (looksLikeHtmlSurface(normalized)) {
    return /(?:captcha|人机验证|安全验证|身份验证|真人验证|滑块验证|验证码|verify you are human|verify.*captcha)/i.test(stripHtml(normalized));
  }
  if (!looksLikeProviderControlText(normalized)) return false;
  return /(?:captcha|人机验证|安全验证|身份验证|真人验证|滑块验证|验证你不是机器人|请输入.{0,24}验证码|请.{0,24}(?:输入|完成|通过|进行).{0,24}验证码|验证码(?:错误|过期|校验失败|验证失败)|complete.{0,32}captcha|verify.{0,32}(?:human|captcha))/i.test(normalized);
}

export function looksLikeProviderRateLimitGate(text: string): boolean {
  const normalized = normalizeSurfaceText(text);
  if (!normalized) return false;
  if (looksLikeHtmlSurface(normalized)) {
    return PROVIDER_RATE_LIMIT_HTML_RE.test(stripHtml(normalized));
  }
  if (!looksLikeProviderControlText(normalized)) return false;
  return PROVIDER_RATE_LIMIT_RE.test(normalized);
}

export function looksLikeProviderErrorSurface(text: string): boolean {
  const normalized = normalizeSurfaceText(text);
  if (!normalized) return false;
  if (looksLikeHtmlSurface(normalized)) {
    return /(?:bad gateway|service unavailable|gateway timeout|application error|something went wrong|页面加载失败|(?:服务|系统)繁忙(?:[，,。.!！]|$)|网络错误|请求失败|ERR_[A-Z_]+|HTTP\s*(?:4\d\d|5\d\d)|error|unavailable|gateway|cloudflare|错误|不可用)/i.test(stripHtml(normalized));
  }
  if (!looksLikeProviderControlText(normalized)) return false;
  return /(?:bad gateway|service unavailable|gateway timeout|application error|something went wrong|页面加载失败|(?:服务|系统)繁忙(?:[，,。.!！]|$)|网络错误|请求失败|ERR_[A-Z_]+|HTTP\s*(?:4\d\d|5\d\d))/i.test(normalized);
}

function normalizeSurfaceText(text: string): string {
  return String(text || '').replace(/\u00a0/g, ' ').trim();
}

function looksLikeProviderLoginRequiredSentinel(text: string): boolean {
  const compact = text.trim();
  if (/^(?:error\s*:\s*)?LOGIN_REQUIRED$/i.test(compact)) return true;
  if (/^RESPONSE_CORRUPTED\s*:\s*login-required$/i.test(compact)) return true;
  if (compact.length <= 240 && /^(?:error|failed|failure|provider\s+failed)\b[\s\S]*\bLOGIN_REQUIRED\b/i.test(compact)) {
    return true;
  }
  if (compact.length <= 1000 && /^[{[]/.test(compact)) {
    try {
      const parsed = JSON.parse(compact);
      return containsLoginRequiredControlValue(parsed);
    } catch {
      return false;
    }
  }
  return false;
}

function containsLoginRequiredControlValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsLoginRequiredControlValue(item));
  }
  const record = value as Record<string, unknown>;
  return record.error === 'LOGIN_REQUIRED'
    || record.code === 'LOGIN_REQUIRED'
    || record.reason === 'LOGIN_REQUIRED'
    || record.errorCategory === 'login-required';
}

function looksLikeProviderControlText(text: string): boolean {
  const head = text.slice(0, 240);
  if (/^(?:\s|[#>*-])*(?:error|错误|异常|failed|failure|登录|请先?登录|重新登录|sign\s*in|log\s*in|login|required|验证码|请输入|captcha|rate[-_ ]?limit(?:ed|ing)?\b|too many requests|HTTP\s*(?:4\d\d|5\d\d)|服务繁忙|系统繁忙|限流(?:中|保护|限制|状态|[，,。.!！：:]))/i.test(head)) {
    return true;
  }
  if (looksLikeModelAnswerText(text)) return false;
  return text.length <= 1200;
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

function looksLikeModelAnswerText(text: string): boolean {
  return /(?:^|\n)\s*#{1,6}\s+\S/.test(text)
    || /(?:\[TOOL:[A-Za-z_]|<tool_call\b)/i.test(text)
    || /(?:结论|依据|原因|问题|风险|建议|对策|方案|任务拆解|验证结果|summary|conclusion|evidence|recommendation)/i.test(text);
}
