import type { Page } from 'playwright';

export const CONTINUE_GENERATION_APPEAR_WAIT_MS = 1_500;
const CONTINUE_GENERATION_POLL_MS = 120;

const CONTINUE_GENERATION_ENGLISH = new Set([
  'continue',
  'continuegenerating',
  'continuegeneration',
  'continueresponse',
  'continueanswer',
  'continuewriting',
]);

const CONTINUE_GENERATION_CHINESE_MARKERS = [
  '继续生成',
  '继续回复',
  '继续回答',
  '继续输出',
  '继续完成',
];

const CONTINUE_GENERATION_ROLE_NAME =
  /^\s*(继续\s*(?:生成(?:\s*内容)?|回复|回答|输出|完成)|Continue(?:\s+(?:generating|generation|response|answer|writing))?)\s*$/i;

export function normalizeContinueGenerationText(text: string): string {
  return text.replace(/[\s\u200b-\u200d\ufeff]+/g, '').trim().toLowerCase();
}

export function isContinueGenerationText(text: string): boolean {
  const normalized = normalizeContinueGenerationText(text);
  if (!normalized) return false;
  if (CONTINUE_GENERATION_CHINESE_MARKERS.some(marker => normalized.includes(marker))) return true;
  return CONTINUE_GENERATION_ENGLISH.has(normalized);
}

export function mergeContinuedAssistantText(prefix: string, current: string): string {
  const previous = String(prefix || '').trim();
  const next = String(current || '').trim();
  if (!previous) return next;
  if (!next) return previous;
  if (next.startsWith(previous)) return next;

  const previousFingerprint = normalizeResponseFingerprint(previous);
  const nextFingerprint = normalizeResponseFingerprint(next);
  if (commonPrefixLength(previousFingerprint, nextFingerprint, 240) >= 80) {
    return next;
  }
  if (previous.startsWith(next)) return previous;

  const overlap = longestContinuationOverlap(previous, next);
  if (overlap >= 24) return previous + next.slice(overlap);
  return `${previous}\n\n${next}`;
}

function normalizeResponseFingerprint(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function commonPrefixLength(left: string, right: string, limit: number): number {
  const max = Math.min(left.length, right.length, limit);
  let index = 0;
  while (index < max && left[index] === right[index]) index += 1;
  return index;
}

function longestContinuationOverlap(prefix: string, continuation: string): number {
  const max = Math.min(prefix.length, continuation.length, 4_000);
  for (let length = max; length >= 24; length -= 1) {
    if (prefix.endsWith(continuation.slice(0, length))) return length;
  }
  return 0;
}

export async function clickContinueGenerationButton(
  page: Page,
  selectors: readonly string[],
): Promise<boolean> {
  if (await clickByAccessibleRole(page)) return true;
  if (await clickByVisibleText(page)) return true;
  return clickBySelectors(page, selectors);
}

export async function waitAndClickContinueGenerationButton(
  page: Page,
  selectors: readonly string[],
  timeoutMs = CONTINUE_GENERATION_APPEAR_WAIT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await clickContinueGenerationButton(page, selectors)) return true;
    await page.waitForTimeout(CONTINUE_GENERATION_POLL_MS);
  }
  return false;
}

async function clickByAccessibleRole(page: Page): Promise<boolean> {
  try {
    const locator = page.getByRole('button', { name: CONTINUE_GENERATION_ROLE_NAME });
    const count = await locator.count();
    if (count < 1) return false;
    await locator.nth(count - 1).click({ timeout: 1_000 });
    return true;
  } catch {
    return false;
  }
}

async function clickByVisibleText(page: Page): Promise<boolean> {
  const clicked = await page.evaluate(`(function() {
    var english = ${JSON.stringify([...CONTINUE_GENERATION_ENGLISH])};
    var chinese = ${JSON.stringify(CONTINUE_GENERATION_CHINESE_MARKERS)};
    function normalizeText(text) {
      return String(text || '').replace(/[\\s\\u200b-\\u200d\\ufeff]+/g, '').trim().toLowerCase();
    }
    function matches(text) {
      var normalized = normalizeText(text);
      if (!normalized) return false;
      for (var i = 0; i < chinese.length; i++) {
        if (normalized.indexOf(chinese[i]) >= 0) return true;
      }
      return english.indexOf(normalized) >= 0;
    }
    function visible(el) {
      var r = el.getBoundingClientRect();
      if (!r || r.width <= 0 || r.height <= 0) return false;
      var style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    }
    function disabled(el) {
      return !!(el.disabled || el.getAttribute('aria-disabled') === 'true');
    }
    var els = document.querySelectorAll('button, [role="button"], div[class*="btn"], div[class*="button"], a[class*="btn"]');
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i];
      var t = (el.innerText || el.textContent || '').trim();
      if (matches(t) && visible(el) && !disabled(el)) {
        el.click();
        return true;
      }
    }
    return false;
  })()`).catch(() => false) as boolean;
  return clicked;
}

async function clickBySelectors(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count < 1) continue;
      await locator.nth(count - 1).click({ timeout: 1_000 });
      return true;
    } catch {
      // Try the next selector.
    }
  }
  return false;
}
