import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  captureNaturalUiDispatchBaseline,
  createNaturalUiPromptIdentity,
  waitForNaturalUiForegroundDispatch,
} from './natural-ui-dispatch-evidence.mjs';

const UI_ACTION_TIMEOUT_MS = 3_000;

export async function submitNaturalUiPrompt(options) {
  return new NaturalUiPromptSubmitter(options).submit();
}

class NaturalUiPromptSubmitter {
  constructor(options) {
    this.debugPort = options.debugPort;
    this.domProbeMs = options.domProbeMs;
    this.prompt = options.prompt;
    this.promptIdentity = createNaturalUiPromptIdentity(options.prompt);
    this.runsDir = path.join(options.workspaceDir, '.devseek', 'runs');
    this.artifactDir = options.artifactDir;
    this.waitForReady = options.waitForReady;
    this.progress = options.reportProgress;
  }

  async submit() {
    this.progress('natural-ui-submit-wait-ready', {
      debugPort: this.debugPort,
      inputSelector: '#input',
      sendSelector: '#send-btn',
      domProbeMs: this.domProbeMs,
    });
    await this.waitForReady();
    const version = await waitForDebugEndpoint(this.debugPort, 90_000);
    this.progress('natural-ui-debug-ready', {
      browser: version.Browser,
      hasWebSocketDebuggerUrl: Boolean(version.webSocketDebuggerUrl),
    });

    const { chromium } = await import('playwright');
    let browser;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        throw new Error('Playwright CDP connection did not expose a VS Code browser context');
      }
      let found;
      try {
        found = await this.findInputFrame(contexts);
      } catch (error) {
        const domError = String(error?.message || error);
        this.progress('natural-ui-dom-submit-unavailable', { error: domError });
        return await this.submitThroughScreenCoordinates(contexts, domError);
      }
      return await this.submitThroughDomFrame(found);
    } finally {
      if (browser) await withinUiDeadline(browser.close(), 'disconnect CDP').catch(() => {});
    }
  }

  async submitThroughDomFrame(found) {
    const input = found.frame.locator('#input');
    await input.click({ timeout: 10_000 });
    await input.fill('');
    let entryMethod = 'pressSequentially';
    try {
      await input.pressSequentially(this.prompt, { delay: 2 });
    } catch {
      entryMethod = 'fill-fallback';
      await input.fill(this.prompt);
    }
    const typedValue = await input.inputValue();
    if (typedValue !== this.prompt) {
      throw new Error(`真实 Webview 输入框内容不匹配：typed=${typedValue.length}, expected=${this.prompt.length}`);
    }

    const dispatchBaseline = captureNaturalUiDispatchBaseline(this.runsDir);
    await found.frame.locator('#send-btn').click({ timeout: 10_000 });
    const promptNeedle = this.prompt.slice(0, Math.min(80, this.prompt.length));
    const userTurnObserved = await found.frame.waitForFunction((needle) => {
      const messages = document.getElementById('messages')?.textContent || '';
      const inputValue = document.getElementById('input')?.value || '';
      return inputValue.trim() === '' && messages.includes(needle);
    }, promptNeedle, { timeout: 15_000 }).then(() => true).catch(() => false);
    const foregroundDispatch = await this.waitForDispatch(dispatchBaseline);
    const ok = userTurnObserved && foregroundDispatch.observed;
    return this.finish({
      ok,
      error: ok ? '' : 'Webview 消息或本轮前台运行证据未出现。',
      route: 'vscode-webview-textarea-click',
      entryMethod,
      userTurnObserved,
      foregroundDispatch,
      inputSelector: '#input',
      sendSelector: '#send-btn',
      frameUrl: found.frame.url(),
      pageTitle: found.title,
    });
  }

  async submitThroughScreenCoordinates(contexts, domFallbackError) {
    const page = await findWorkbenchPage(contexts);
    if (!page) throw new Error('Playwright CDP connection exposed no VS Code page');
    await this.dismissBlockingWorkbenchUi(page);
    const viewport = await withinUiDeadline(page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    })), 'read workbench viewport');
    const webviewBounds = await findVisibleWebviewBounds(page);
    const surfaceRight = webviewBounds ? webviewBounds.x + webviewBounds.width : viewport.width;
    const surfaceBottom = webviewBounds ? webviewBounds.y + webviewBounds.height : viewport.height;
    const inputPoint = {
      x: Math.min(viewport.width - 24, Math.max(24, surfaceRight - 175)),
      y: Math.min(viewport.height - 24, Math.max(24, surfaceBottom - 72)),
    };
    const sendPoint = {
      x: Math.min(viewport.width - 24, Math.max(24, surfaceRight - 24)),
      y: inputPoint.y,
    };
    const screenshotBeforeInput = path.join(this.artifactDir, 'natural-ui-before-input.png');
    const screenshotBeforeSend = path.join(this.artifactDir, 'natural-ui-input-before-send.png');
    await captureScreenshot(page, screenshotBeforeInput);
    await withinUiDeadline(page.mouse.click(inputPoint.x, inputPoint.y), 'focus visible DevSeek input');
    await withinUiDeadline(
      page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V'),
      'paste prompt into visible DevSeek input',
    );
    await delay(250);
    await captureScreenshot(page, screenshotBeforeSend);

    const screenshotBeforeInputSha256 = fileSha256(screenshotBeforeInput);
    const screenshotBeforeSendSha256 = fileSha256(screenshotBeforeSend);
    const inputVisualChanged = Boolean(
      screenshotBeforeInputSha256
      && screenshotBeforeSendSha256
      && screenshotBeforeInputSha256 !== screenshotBeforeSendSha256,
    );
    const sharedEvidence = {
      domFallbackError,
      webviewBounds,
      inputPoint,
      sendPoint,
      viewport,
      screenshotBeforeInput,
      screenshotBeforeSend,
      screenshotBeforeInputSha256,
      screenshotBeforeSendSha256,
      inputVisualChanged,
    };
    if (!inputVisualChanged) {
      return this.finish({
        ok: false,
        error: '坐标输入后画面未变化，拒绝把未认证点击当作真实用户提交。',
        route: 'vscode-webview-screen-coordinate-clipboard',
        entryMethod: 'screen-coordinate-click-system-clipboard-paste',
        userTurnObserved: false,
        foregroundDispatch: this.emptyDispatch(),
        ...sharedEvidence,
      });
    }

    const dispatchBaseline = captureNaturalUiDispatchBaseline(this.runsDir);
    await withinUiDeadline(page.mouse.click(sendPoint.x, sendPoint.y), 'click visible DevSeek send button');
    const foregroundDispatch = await this.waitForDispatch(dispatchBaseline);
    const screenshotAfterSend = path.join(this.artifactDir, 'natural-ui-input-after-send.png');
    await captureScreenshot(page, screenshotAfterSend);
    return this.finish({
      ok: foregroundDispatch.observed,
      error: foregroundDispatch.observed ? '' : '坐标提交后没有出现属于本轮的新前台运行证据。',
      route: 'vscode-webview-screen-coordinate-clipboard',
      entryMethod: 'screen-coordinate-click-system-clipboard-paste',
      userTurnObserved: foregroundDispatch.observed,
      foregroundDispatch,
      ...sharedEvidence,
      screenshotAfterSend,
    });
  }

  async findInputFrame(contexts) {
    const deadline = Date.now() + this.domProbeMs;
    let lastSummary = [];
    while (Date.now() < deadline) {
      lastSummary = [];
      for (const context of contexts) {
        for (const page of context.pages()) {
          const title = await page.title().catch(() => '');
          for (const frame of page.frames()) {
            const frameUrl = frame.url();
            lastSummary.push({ title, url: frameUrl });
            const hasControls = await withinUiDeadline(
              frame.evaluate(() => Boolean(
                document.querySelector('#input') && document.querySelector('#send-btn'),
              )),
              'probe DevSeek webview DOM',
              250,
            ).catch(() => false);
            if (hasControls) {
              this.progress('natural-ui-input-found', { title, frameUrl });
              return { page, frame, title };
            }
          }
        }
      }
      await delay(1000);
    }
    throw new Error('未在真实 VS Code Webview 中找到 DevSeek 输入框：' + JSON.stringify(lastSummary.slice(-8)));
  }

  async dismissBlockingWorkbenchUi(page) {
    await page.bringToFront().catch(() => {});
    let dismissed = 0;
    const selectors = [
      '.notifications-toasts [role="button"][aria-label*="Clear"]',
      '.notifications-toasts [role="button"][aria-label*="Close"]',
      '.notifications-toasts .codicon-notifications-clear',
      '.notifications-toasts .codicon-close',
    ];
    for (const selector of selectors) {
      const controls = page.locator(selector);
      const count = await withinUiDeadline(controls.count(), 'inspect workbench notification').catch(() => 0);
      for (let index = count - 1; index >= 0; index -= 1) {
        const control = controls.nth(index);
        if (!await withinUiDeadline(control.isVisible(), 'inspect notification control').catch(() => false)) continue;
        if (await withinUiDeadline(control.click(), 'dismiss workbench notification').then(() => true).catch(() => false)) dismissed += 1;
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
    await delay(300);
    this.progress('natural-ui-workbench-cleared', { dismissed });
  }

  waitForDispatch(baseline) {
    return waitForNaturalUiForegroundDispatch({
      baseline,
      expectedPrompt: this.promptIdentity,
      timeoutMs: 30_000,
    });
  }

  emptyDispatch() {
    return { observed: false, runId: '', ts: '', prompt: this.promptIdentity };
  }

  finish(result) {
    const complete = {
      ...result,
      naturalUi: true,
      commandInjected: false,
      debugPort: this.debugPort,
      promptLength: this.promptIdentity.length,
      promptSha256: this.promptIdentity.sha256,
    };
    this.progress('natural-ui-submitted', complete);
    return complete;
  }
}

async function findWorkbenchPage(contexts) {
  let fallback = null;
  for (const context of contexts) {
    for (const page of context.pages()) {
      fallback ||= page;
      const title = await withinUiDeadline(page.title(), 'read workbench title').catch(() => '');
      if (title.includes('Visual Studio Code')) return page;
    }
  }
  return fallback;
}

async function findVisibleWebviewBounds(page) {
  return withinUiDeadline(page.evaluate(() => {
    const candidates = [...document.querySelectorAll('iframe, webview')]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width >= 240 && rect.height >= 300 && rect.right > window.innerWidth / 2)
      .sort((left, right) => right.right - left.right || right.height - left.height);
    const rect = candidates[0];
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  }), 'locate visible DevSeek webview').catch(() => null);
}

async function captureScreenshot(page, filePath) {
  await withinUiDeadline(
    page.screenshot({ path: filePath, fullPage: false }),
    `capture ${path.basename(filePath)}`,
  ).catch(() => {});
}

async function waitForDebugEndpoint(port, waitMs) {
  const deadline = Date.now() + waitMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const version = await response.json();
        if (version?.webSocketDebuggerUrl) return version;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await delay(500);
  }
  throw new Error(`VS Code 调试端口未就绪 port=${port}: ${lastError}`);
}

function fileSha256(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withinUiDeadline(promise, action, timeoutMs = UI_ACTION_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${action} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
