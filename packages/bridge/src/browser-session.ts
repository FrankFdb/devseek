import type { Browser, BrowserContext, Page } from 'playwright';

export interface BrowserSessionSnapshot {
  hasBrowser: boolean;
  hasContext: boolean;
  hasPage: boolean;
  browserConnected?: boolean;
  pageClosed?: boolean;
  url?: string;
}

export class BrowserSession {
  constructor(
    private readonly getBrowser: () => Browser | null,
    private readonly getContext: () => BrowserContext | null,
    private readonly getPage: () => Page | null,
  ) {}

  page(): Page {
    const page = this.getPage();
    if (!page) throw new Error('Browser page is not initialized');
    return page;
  }

  snapshot(): BrowserSessionSnapshot {
    const browser = this.getBrowser();
    const context = this.getContext();
    const page = this.getPage();
    const pageClosed = page?.isClosed() ?? false;
    return {
      hasBrowser: Boolean(browser),
      hasContext: Boolean(context),
      hasPage: Boolean(page) && !pageClosed,
      browserConnected: browser?.isConnected() ?? Boolean(browser),
      pageClosed,
      url: page && !pageClosed ? page.url() : undefined,
    };
  }
}
