import type { Page } from 'playwright';
import { DEEPSEEK_DOM_SELECTORS } from './deepseek-dom-selectors';
import {
  DeepSeekResponseExtraction,
  DeepSeekResponseSnapshot,
  extractDeepSeekResponse,
} from './response-extractor';

const FINGERPRINT_SELECTOR_GROUPS = [
  'loggedInIndicator',
  'chatInput',
  'sendButton',
  'assistantMessage',
] as const;

export class ConversationDriver {
  constructor(private readonly selectors = DEEPSEEK_DOM_SELECTORS) {}

  extract(snapshot: DeepSeekResponseSnapshot): DeepSeekResponseExtraction {
    return extractDeepSeekResponse(snapshot);
  }

  async captureSnapshot(page: Page): Promise<DeepSeekResponseSnapshot> {
    const assistantMessages = await collectTexts(page, this.selectors.assistantMessage);
    const selectorCounts = await countSelectorGroups(page, this.selectors, FINGERPRINT_SELECTOR_GROUPS);
    const loggedInIndicatorCount = selectorCounts.loggedInIndicator ?? 0;
    return {
      assistantMessages,
      loggedInIndicatorCount,
      selectorCounts,
      url: page.url(),
    };
  }
}

async function collectTexts(page: Page, selectors: readonly string[]): Promise<string[]> {
  const texts: string[] = [];
  for (const selector of selectors) {
    try {
      const values = await page.locator(selector).allTextContents();
      texts.push(...values);
    } catch {
      // Try the next selector.
    }
  }
  return texts;
}

async function countAny(page: Page, selectors: readonly string[]): Promise<number> {
  for (const selector of selectors) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) return count;
    } catch {
      // Try the next selector.
    }
  }
  return 0;
}

async function countSelectorGroups(
  page: Page,
  selectors: typeof DEEPSEEK_DOM_SELECTORS,
  groups: readonly (keyof typeof DEEPSEEK_DOM_SELECTORS)[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[group] = await countAny(page, selectors[group]);
  }
  return counts;
}
