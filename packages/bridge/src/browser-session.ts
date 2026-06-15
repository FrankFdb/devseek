import type { Browser, BrowserContext, Page } from 'playwright';

export interface BrowserSessionSnapshot {
  hasBrowser: boolean;
  hasContext: boolean;
  hasPage: boolean;
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
    const page = this.getPage();
    return {
      hasBrowser: Boolean(this.getBrowser()),
      hasContext: Boolean(this.getContext()),
      hasPage: Boolean(page),
      url: page?.url(),
    };
  }
}
