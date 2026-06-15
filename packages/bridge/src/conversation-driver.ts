import type { Page } from 'playwright';
import { DEEPSEEK_DOM_SELECTORS } from './deepseek-dom-selectors';
import {
  DeepSeekResponseExtraction,
  DeepSeekResponseSnapshot,
  extractDeepSeekResponse,
} from './response-extractor';

export class ConversationDriver {
  constructor(private readonly selectors = DEEPSEEK_DOM_SELECTORS) {}

  extract(snapshot: DeepSeekResponseSnapshot): DeepSeekResponseExtraction {
    return extractDeepSeekResponse(snapshot);
  }

  async captureSnapshot(page: Page): Promise<DeepSeekResponseSnapshot> {
    const assistantMessages = await collectTexts(page, this.selectors.assistantMessage);
    const loggedInIndicatorCount = await countAny(page, this.selectors.loggedInIndicator);
    return {
      assistantMessages,
      loggedInIndicatorCount,
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
