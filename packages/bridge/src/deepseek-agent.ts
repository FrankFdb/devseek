import { chromium, Browser, BrowserContext, Page, ElementHandle } from 'playwright';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  summarizeTraceText,
  type DevSeekTraceLogger,
} from '@devseek-netai/shared';
import { DEEPSEEK_URL } from './config';
import { DEEPSEEK_DOM_SELECTORS as SELECTORS } from './deepseek-dom-selectors';
import { extractDeepSeekResponse, isLoginUrl } from './response-extractor';
import { getStorageStatePath, loadCookies, saveCookies } from './session';
import { BrowserSession } from './browser-session';
import { ConversationDriver } from './conversation-driver';
import { checkBridgeHealth } from './bridge-health-check';
import {
  clickContinueGenerationButton,
  CONTINUE_GENERATION_APPEAR_WAIT_MS,
  waitAndClickContinueGenerationButton,
} from './continue-generation';

const STREAM_POLL_INTERVAL_MS = 80;
const STOP_DISAPPEARED_STABLE_TICKS = 5;
const READY_INPUT_STABLE_TICKS = 30;
const RESPONSE_CONTENT_QUIET_MS = 2_400;
const RESPONSE_LATE_GROWTH_PROBE_MS = 900;
const CONTINUE_GENERATION_RESUME_WAIT_MS = 250;
const CODE_TAB_RENDER_WAIT_MS = 180;
const INCOMPLETE_INTENT_WAIT_MS = 1_500;
const RESPONSE_ABSOLUTE_TIMEOUT_MIN_MS = 90_000;
const RESPONSE_ABSOLUTE_TIMEOUT_MAX_MS = 180_000;
const RESPONSE_ABSOLUTE_TIMEOUT_FACTOR = 1.5;
const GENERATION_ABORT_TIMEOUT_MS = 12_000;
const GENERATION_ABORT_STABLE_TICKS = 5;
const PROMPT_SUBMIT_RETRY_WAIT_MS = 800;

function responseAbsoluteTimeoutMs(timeoutMs: number): number {
  const scaled = Math.ceil(timeoutMs * RESPONSE_ABSOLUTE_TIMEOUT_FACTOR);
  return Math.min(Math.max(scaled, RESPONSE_ABSOLUTE_TIMEOUT_MIN_MS), RESPONSE_ABSOLUTE_TIMEOUT_MAX_MS);
}

function responseStreamTimeoutError(input: {
  timeoutMs: number;
  absoluteTimeoutMs: number;
  partialChars: number;
  newMessageSeen: boolean;
  phase: string;
}): Error {
  const progress = input.newMessageSeen
    ? `partialChars=${input.partialChars}`
    : 'no new assistant message was detected';
  return new Error(
    `RESPONSE_CORRUPTED:stream-timeout:DeepSeek response did not complete within ${input.absoluteTimeoutMs}ms `
    + `(single-round timeout=${input.timeoutMs}ms, phase=${input.phase}, ${progress}).`,
  );
}

function looksLikeIncompleteAssistantIntent(text: string): boolean {
  const tail = String(text || '')
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join('\n');
  if (!tail) return false;
  return /(?:让我|我来|接下来|下面|现在|首先|然后|继续|需要|将|准备)[\s\S]{0,120}(?:修复|修改|更新|创建|写入|执行|读取|查看|检查|编译|运行|调用|处理)[\s\S]{0,80}[：:]\s*$/i.test(tail);
}

function contentMutationClockScript(reset: boolean): string {
  return `(function(reset){
    var w = window;
    var now = Date.now();
    if (reset || !w.__devseekContentMutationAt) w.__devseekContentMutationAt = now;
    if (!w.__devseekContentObserver && document.body && typeof MutationObserver !== 'undefined') {
      w.__devseekContentObserver = new MutationObserver(function(mutations){
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].type === 'childList' || mutations[i].type === 'characterData') {
            w.__devseekContentMutationAt = Date.now();
            return;
          }
        }
      });
      w.__devseekContentObserver.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
    return Math.max(0, now - (w.__devseekContentMutationAt || now));
  })(${reset ? 'true' : 'false'})`;
}

export interface SendOptions {
  newSession?: boolean;
  timeoutMs?: number;
  /** 模型模式：fast = V3（默认），r1 = DeepThink R1 */
  mode?: 'fast' | 'r1';
  /** 流式回调：每当有新增文本时触发 */
  onDelta?: (delta: string) => void;
  /** 附件文件绝对路径列表，通过 DeepSeek 网页原生上传机制发送 */
  files?: string[];
  /** 项目级诊断日志 */
  trace?: DevSeekTraceLogger;
}

export interface AgentOptions {
  headless?: boolean;
  timeoutMs?: number;
}

/** 登录过期，需要重新登录 */
export class LoginRequiredError extends Error {
  constructor() {
    super('LOGIN_REQUIRED');
    this.name = 'LoginRequiredError';
  }
}

/** 从一组候选选择器中找到第一个存在的元素 */
async function findElement(page: Page, selectors: readonly string[]): Promise<ElementHandle | null> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch {
      // try next
    }
  }
  return null;
}

/** 等待一组候选选择器中任意一个出现 */
async function waitForAny(page: Page, selectors: readonly string[], timeout = 15000): Promise<ElementHandle> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = await findElement(page, selectors);
    if (el) return el;
    await page.waitForTimeout(300);
  }
  throw new Error(`Timeout waiting for any of: ${selectors.join(', ')}`);
}

async function clickAny(page: Page, selectors: readonly string[], timeout = 5000): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      const count = await locator.count();
      if (count < 1) continue;
      await locator.click({ timeout });
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

export class DeepSeekAgent {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cancelRequested = false;
  private currentInterceptCleanup: (() => void) | null = null;
  /** 当前已激活的模式（避免重复点击） */
  private currentMode: 'fast' | 'r1' = 'fast';
  /** 预上传的文件路径（用于批次预附加，sendMessage 时跳过重复附加） */
  private _preAttachedFiles: string[] = [];
  private readonly browserSession = new BrowserSession(
    () => this.browser,
    () => this.context,
    () => this.page,
  );
  private readonly conversationDriver = new ConversationDriver(SELECTORS);

  private readonly options: Required<AgentOptions>;

  constructor(options: AgentOptions = {}) {
    this.options = {
      headless: false,
      timeoutMs: 60_000,
      ...options,
    };
  }

  // ----------------------------------------------------------------
  // 初始化
  // ----------------------------------------------------------------

  async init(): Promise<void> {
    await this.close();  // 清理可能残留的旧浏览器实例
    await this._launchBrowser(this.options.headless);

    const loggedIn = await this.checkLoginState();
    if (!loggedIn) {
      // 关闭无头浏览器，直接抛出错误让上层处理
      console.warn('[agent] Cookies expired or not logged in.');
      await this.close();
      throw new LoginRequiredError();
    }
    console.log('[agent] Already logged in.');
  }

  /** 打开可见浏览器让用户手动登录，登录成功后保存 cookie 并关闭浏览器 */
  async loginWithVisibleBrowser(): Promise<void> {
    await this.close();
    await this._launchBrowser(false);
    const page = this.requirePage();

    console.log('[agent] Visible browser opened, waiting for manual login (5 min)...');

    // 轮询等待登录： URL 不是登录页 + 聊天输入框可用
    const deadline = Date.now() + 300_000;
    let confirmed = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      const url = page.url();
      // 如果在登录页，继续等待
      if (isLoginUrl(url)) continue;
      // 检测聊天输入框（登录后才有）
      const chatInput = await findElement(page, SELECTORS.chatInput);
      if (!chatInput) continue;
      // 多等 2 秒确认页面稳定且 Cookie 已全部写入
      await page.waitForTimeout(2000);
      // 再次检查 URL 没有跳转
      if (isLoginUrl(page.url())) continue;
      confirmed = true;
      break;
    }

    if (!confirmed) {
      await this.close();
      throw new Error('Login timeout: user did not complete login within 5 minutes.');
    }

    if (this.context) await saveCookies(this.context);
    console.log('[agent] Login successful, cookies saved. Keeping browser open for chat use.');
    // 不关闭浏览器！保持 session 存活用于后续聊天
    if (process.env.DEVSEEK_BRIDGE_KEEP_VISIBLE === '1') {
      console.log('[agent] Keeping visible browser window open for live harness observation.');
    } else {
      // 尝试最小化窗口（让用户不太分心）
      await this._minimizeWindow();
    }
  }

  private async _minimizeWindow(): Promise<void> {
    if (!this.browser) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = await (this.browser as any).newBrowserCDPSession();
      const result = await session.send('Target.getTargets', {});
      const target = result.targetInfos?.find((t: { type: string; targetId: string }) => t.type === 'page');
      if (target) {
        const { windowId } = await session.send('Browser.getWindowForTarget', { targetId: target.targetId });
        await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        console.log('[agent] Browser window minimized.');
      }
      await session.detach();
    } catch {
      console.log('[agent] Could not minimize window (user can minimize manually).');
    }
  }

  private async _launchBrowser(headless: boolean): Promise<void> {
    this.browser = await chromium.launch({
      headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    const storageState = getStorageStatePath();
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      ...(storageState ? { storageState } : {}),
    });

    await this.context.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      window.chrome = { runtime: {} };
    `);

    if (!storageState) await loadCookies(this.context);
    this.page = await this.context.newPage();

    console.log('[agent] Navigating to DeepSeek...');
    await this.page.goto(DEEPSEEK_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  private async checkLoginState(): Promise<boolean> {
    const page = this.requirePage();
    // 等待页面完全加载，包括JS跳转（SPA）
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      // 涅樣备用：如果 networkidle 超时，至少等 3秒
      await page.waitForTimeout(3000);
    }
    const snapshot = await this.conversationDriver.captureSnapshot(page);
    const health = checkBridgeHealth(this.browserSession.snapshot(), snapshot.loggedInIndicatorCount);
    const url = snapshot.url || page.url();
    console.log('[agent] checkLoginState URL:', url);
    if (!health.browserReady || isLoginUrl(url)) {
      console.log('[agent] Detected login redirect, not logged in.');
      return false;
    }
    try {
      // 优先检测聊天输入框（登录态特有）
      await waitForAny(page, SELECTORS.chatInput, 6000);
      // 再等 500ms 确认页面没有跳转到登录页
      await page.waitForTimeout(500);
      const finalUrl = page.url();
      if (isLoginUrl(finalUrl)) return false;
      console.log('[agent] Login confirmed: chat input found.');
      return true;
    } catch {
      console.log('[agent] Chat input not found, assuming not logged in.');
      return false;
    }
  }

  // ----------------------------------------------------------------
  // 发送消息
  // ----------------------------------------------------------------

  /**
   * 切换 DeepThink (R1) 模式。
   * fast → 确保 DeepThink 未激活；r1 → 确保 DeepThink 已激活。
   * 若找不到按钮则静默忽略。
   */
  async setMode(mode: 'fast' | 'r1'): Promise<void> {
    if (!this.page || this.currentMode === mode) return;
    const page = this.page;
    try {
      // 检查当前 DeepThink 是否已激活
      const activeEl = await findElement(page, [...SELECTORS.deepThinkActive]);
      const isActive = activeEl !== null;

      if (mode === 'r1' && !isActive) {
        // 需要激活 DeepThink
        const btn = await findElement(page, [...SELECTORS.deepThinkButton]);
        if (btn) { await btn.click(); await page.waitForTimeout(300); }
        else { console.warn('[agent] setMode: DeepThink button not found, skipping.'); return; }
      } else if (mode === 'fast' && isActive) {
        // 需要关闭 DeepThink
        const btn = await findElement(page, [...SELECTORS.deepThinkButton]);
        if (btn) { await btn.click(); await page.waitForTimeout(300); }
        else { console.warn('[agent] setMode: DeepThink button not found, skipping.'); return; }
      }
      this.currentMode = mode;
      console.log(`[agent] Mode switched to: ${mode}`);
    } catch (e) {
      console.warn('[agent] setMode failed (non-fatal):', (e as Error).message);
    }
  }

  async sendMessage(prompt: string, opts: SendOptions = {}): Promise<string> {
    const page = this.requirePage();
    this.cancelRequested = false;
    this._diagnosticDone = false;  // 每次新消息重置，确保诊断能捕获目标响应
    let effectivePrompt = prompt;
    let filesAttached = false;

    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs;
    opts.trace?.info('deepseek-web', 'send-message-start', {
      newSession: opts.newSession,
      timeoutMs,
      mode: opts.mode,
      files: opts.files?.map(file => nodePath.basename(file)),
      prompt: summarizeTraceText(prompt),
    });

    if (opts.newSession) {
      await this.startNewSession();
    }

    // 切换模型模式（fast / r1），不阻断主流程
    if (opts.mode) {
      await this.setMode(opts.mode);
    }

    if (opts.files && opts.files.length > 0) {
      // Skip re-attach if all files were pre-attached via preAttachFiles()
      const allPreAttached = !opts.newSession
        && this._preAttachedFiles.length > 0
        && opts.files.every(f => this._preAttachedFiles.includes(f));
      if (allPreAttached) {
        // Verify chips are actually present before skipping re-attach (Fix 4: guard against orphaned pre-attach)
        const chipSelectors = ['[class*="fileItem"]','[class*="file-item"]','[class*="fileChip"]','[class*="file-chip"]','[class*="chatFile"]'];
        const chipsVisible = await page.evaluate(`(function(sel){ try { return document.querySelectorAll(sel).length > 0; } catch(e){ return false; } })(${JSON.stringify(chipSelectors.join(', '))})`).catch(() => false) as boolean;
        if (chipsVisible) {
          console.log('[agent] All files already pre-attached, skipping file upload step.');
          filesAttached = true;
        } else {
          console.log('[agent] Pre-attach chips not found in UI — re-attaching files.');
          await this._attachFiles(page, opts.files);
          filesAttached = true;
        }
      } else {
        try {
          await this._attachFiles(page, opts.files);
          filesAttached = true;
        } catch (attachErr) {
          const errMsg = (attachErr as Error).message;
          const inlineContext = buildInlineFileContext(opts.files);
          if (!inlineContext) {
            opts.onDelta?.(`\n⚠️ **${errMsg}**\n\n`);
            throw attachErr;
          }
          console.warn(`[agent] File upload failed, falling back to inline file context: ${errMsg}`);
          opts.onDelta?.(`\n⚠️ **File upload failed; inlining selected file context instead.**\n\n`);
          effectivePrompt = `${prompt}\n\n${inlineContext}`;
        }
      }
      this._preAttachedFiles = [];
    }

    await this.ensureReadyForNewPrompt(page, opts.trace, 'before-submit');

    // 找到输入框
    const input = await waitForAny(page, SELECTORS.chatInput, 10_000);
    await input.click();

    if (filesAttached) {
      // 有附件时避免 Ctrl+A 清空把附件 chip 一并删除。
      await page.keyboard.press('Control+End');
      await page.waitForTimeout(150);
      await this.insertComposerText(page, effectivePrompt);
      let inputText = await this.getComposerText(page);
      if (!inputText.includes(effectivePrompt.slice(0, Math.min(10, effectivePrompt.length)))) {
        await input.click();
        await page.keyboard.press('Control+End');
        await page.waitForTimeout(150);
        await this.insertComposerText(page, effectivePrompt);
        inputText = await this.getComposerText(page);
      }
      if (!inputText.includes(effectivePrompt.slice(0, Math.min(10, effectivePrompt.length)))) {
        await this.forceSetComposerText(page, effectivePrompt);
        inputText = await this.getComposerText(page);
      }
      if (!inputText.includes(effectivePrompt.slice(0, Math.min(10, effectivePrompt.length)))) {
        throw new Error(`PROMPT_INPUT_FAILED: 无法写入 ${effectivePrompt.length} 字符的请求，请缩小上下文或改用文件/工具读取。`);
      }
    } else {
      // 清空已有内容后输入
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      if (effectivePrompt.length > 30_000) {
        await this.insertComposerText(page, effectivePrompt);
      } else {
        // 模拟人类打字（避免防抖失效）
        await input.fill(effectivePrompt);
      }
      const inputText = await this.getComposerText(page);
      if (!inputText.includes(effectivePrompt.slice(0, Math.min(10, effectivePrompt.length)))) {
        throw new Error(`PROMPT_INPUT_FAILED: 无法写入 ${effectivePrompt.length} 字符的请求，请缩小上下文或改用文件/工具读取。`);
      }
    }
    await page.waitForTimeout(200);

    // 提交前同时记录 AI 消息计数 + 最后一条 AI 文本，双重门控检测新回复
    const baselineAiMsgCount = await page.evaluate(`(function(){
      var msgs = document.querySelectorAll('[class*="ds-message"]');
      var c = 0;
      for (var i = 0; i < msgs.length; i++) {
        if (msgs[i].querySelectorAll('[class*="ds-markdown"]').length > 0) c++;
      }
      return c;
    })()`).catch(() => 0) as number;
    const baselineText = await this.getStreamingAssistantText(page).catch(() => '');
    const submitBaseline = await this.getSubmitState(page);

    await this.resetContentMutationClock(page);
    const requestPayloadId = opts.trace?.payload('provider', 'bridge.effective-prompt', effectivePrompt);
    opts.trace?.debug('deepseek-web', 'effective-prompt-recorded', { payloadId: requestPayloadId });

    const submitCurrentPrompt = async (attempt: 'initial' | 'retry'): Promise<string> => {
      // 提交：优先找发送按钮，找不到就按 Enter
      const sendBtn = await findElement(page, SELECTORS.sendButton);
      const submitMethod = sendBtn ? 'button' : 'enter';
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      opts.trace?.info('deepseek-web', 'message-submit-clicked', {
        promptLength: effectivePrompt.length,
        method: submitMethod,
        attempt,
        baselineMessageCount: submitBaseline.messageCount,
        baselineComposerLength: submitBaseline.composerText.length,
      });
      return submitMethod;
    };

    let submitMethod = await submitCurrentPrompt('initial');
    let submitResult = await this.waitForSubmitConfirmation(page, submitBaseline, effectivePrompt);
    if (!submitResult.confirmed) {
      opts.trace?.error('deepseek-web', 'message-submit-unconfirmed', {
        reason: submitResult.reason,
        promptLength: effectivePrompt.length,
      });
      await this.ensureReadyForNewPrompt(page, opts.trace, 'submit-unconfirmed');
      await page.waitForTimeout(PROMPT_SUBMIT_RETRY_WAIT_MS);
      submitMethod = await submitCurrentPrompt('retry');
      submitResult = await this.waitForSubmitConfirmation(page, submitBaseline, effectivePrompt);
    }
    if (!submitResult.confirmed) {
      throw new Error(`RESPONSE_CORRUPTED:prompt-submit-failed:PROMPT_SUBMIT_FAILED: DeepSeek 网页未确认收到本轮请求（${submitResult.reason}）。请缩小上下文或重试；如果页面输入框仍有内容，说明网页未接收发送动作。`);
    }

    console.log(`[agent] Message sent (${effectivePrompt.length} chars), baselineAiMsgs=${baselineAiMsgCount}, baselineTextLen=${baselineText.length}, method=${submitMethod}, submit=${submitResult.reason}`);
    opts.trace?.info('deepseek-web', 'message-sent', {
      promptLength: effectivePrompt.length,
      method: submitMethod,
      baselineAiMsgCount,
      baselineTextLength: baselineText.length,
      submitEvidence: submitResult.reason,
    });
    const response = await this.waitForResponse(page, timeoutMs, opts.onDelta, baselineAiMsgCount, baselineText);
    const responsePayloadId = opts.trace?.payload('provider', 'bridge.response.raw', response);
    opts.trace?.info('deepseek-web', 'response-received', {
      payloadId: responsePayloadId,
      response: summarizeTraceText(response),
    });
    return response;
  }

  private async getComposerText(page: Page): Promise<string> {
    try {
      const text = await page.evaluate(`(function(){
        var el = document.querySelector('textarea#chat-input')
          || document.querySelector('textarea[placeholder]')
          || document.querySelector('div[contenteditable="true"][class*="input"]')
          || document.querySelector('div[contenteditable="true"]')
          || document.querySelector('textarea');
        if (!el) return '';
        if ('value' in el) return el.value || '';
        return el.textContent || '';
      })()`);
      return String(text || '').trim();
    } catch {
      return '';
    }
  }

  private async forceSetComposerText(page: Page, prompt: string): Promise<void> {
    try {
      await page.evaluate(`(function(text){
        var el = document.querySelector('textarea#chat-input')
          || document.querySelector('textarea[placeholder]')
          || document.querySelector('div[contenteditable="true"][class*="input"]')
          || document.querySelector('div[contenteditable="true"]')
          || document.querySelector('textarea');
        if (!el) return;
        if ('value' in el) {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.textContent = text;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        }
      })(${JSON.stringify(prompt)});`);
      await page.waitForTimeout(120);
    } catch {
      // best effort fallback only
    }
  }

  private async insertComposerText(page: Page, text: string): Promise<void> {
    const chunkSize = 8_000;
    for (let i = 0; i < text.length; i += chunkSize) {
      await page.keyboard.insertText(text.slice(i, i + chunkSize));
      if (i + chunkSize < text.length) {
        await page.waitForTimeout(40);
      }
    }
  }

  private async getSubmitState(page: Page): Promise<{ composerText: string; messageCount: number }> {
    const composerText = await this.getComposerText(page).catch(() => '');
    const messageCount = await page.evaluate(`(function(){
      var selectors = [
        '[class*="ds-message"]',
        '[data-role="user"]',
        '[data-role="assistant"]',
        'div[class*="message"]'
      ];
      var seen = [];
      var count = 0;
      for (var i = 0; i < selectors.length; i++) {
        var nodes = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < nodes.length; j++) {
          if (seen.indexOf(nodes[j]) >= 0) continue;
          seen.push(nodes[j]);
          count++;
        }
      }
      return count;
    })()`).catch(() => 0) as number;
    return { composerText, messageCount };
  }

  private async waitForSubmitConfirmation(
    page: Page,
    baseline: { composerText: string; messageCount: number },
    prompt: string,
    timeoutMs = 8_000,
  ): Promise<{ confirmed: boolean; reason: string }> {
    const prefix = prompt.slice(0, Math.min(10, prompt.length));
    const deadline = Date.now() + timeoutMs;
    let lastState = baseline;
    while (Date.now() < deadline) {
      await page.waitForTimeout(250);
      lastState = await this.getSubmitState(page);
      if (lastState.messageCount > baseline.messageCount) {
        return { confirmed: true, reason: `message-count:${baseline.messageCount}->${lastState.messageCount}` };
      }
      if (prefix && baseline.composerText.includes(prefix) && !lastState.composerText.includes(prefix)) {
        return { confirmed: true, reason: 'composer-cleared' };
      }
      if (!prefix && lastState.composerText.length === 0) {
        return { confirmed: true, reason: 'empty-prompt-cleared' };
      }
    }
    return {
      confirmed: false,
      reason: `message-count:${baseline.messageCount}->${lastState.messageCount}, composer:${baseline.composerText.length}->${lastState.composerText.length}`,
    };
  }

  // ----------------------------------------------------------------
  // 文件预附加（在 sendMessage 前提前上传，减少等待时间）
  // ----------------------------------------------------------------

  async preAttachFiles(files: string[]): Promise<void> {
    if (!files || files.length === 0) return;
    const page = this.requirePage();
    console.log(`[agent] Pre-attaching ${files.length} file(s).`);
    await this._attachFiles(page, files);
    for (const f of files) {
      if (!this._preAttachedFiles.includes(f)) {
        this._preAttachedFiles.push(f);
      }
    }
    console.log(`[agent] Pre-attach done. Total pre-attached: ${this._preAttachedFiles.length}`);
  }

  // ----------------------------------------------------------------
  // 文件附件
  // ----------------------------------------------------------------

  private async _attachFiles(page: Page, files: string[]): Promise<void> {
    console.log(`[agent] Attaching ${files.length} file(s): ${files.join(', ')}`);

    const attached = await this._tryAttachViaChooser(page, files)
      || await this._tryAttachViaInput(page, files);

    if (!attached) {
      throw new Error(`文件附加失败：未找到上传控件（${files.map(f => f.split('/').pop()).join(', ')}）`);
    }

    // Compute upload wait deadline based on total file size
    let totalBytes = 0;
    for (const f of files) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        totalBytes += (require('fs') as typeof import('fs')).statSync(f).size;
      } catch { /* ignore */ }
    }
    // Size-based timeout: 0.1KB→2s, 1KB→3s, 10KB→10s, 100KB→25s, >100KB→40s
    const kb = totalBytes / 1024;
    let uploadTimeoutMs: number;
    if (kb <= 0.1)       uploadTimeoutMs = 2_000;
    else if (kb <= 1)    uploadTimeoutMs = 3_000;
    else if (kb <= 10)   uploadTimeoutMs = 10_000;
    else if (kb <= 100)  uploadTimeoutMs = 25_000;
    else                 uploadTimeoutMs = 40_000;
    console.log(`[agent] File upload timeout: ${uploadTimeoutMs}ms for ${kb.toFixed(1)}KB`);

    await this._waitForFileChips(page, files.length, uploadTimeoutMs);
  }

  private async _tryAttachViaChooser(page: Page, files: string[]): Promise<boolean> {
    try {
      const attachReady = await page.evaluate(`(function(selectors){
        for (var i = 0; i < selectors.length; i++) {
          if (document.querySelector(selectors[i])) return true;
        }
        return false;
      })(${JSON.stringify([...SELECTORS.attachButton])})`).catch(() => false) as boolean;
      if (!attachReady) return false;

      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        (async () => {
          const clicked = await clickAny(page, [...SELECTORS.attachButton], 2500);
          if (!clicked) throw new Error('attach button click failed');
        })(),
      ]);
      await fileChooser.setFiles(files);
      console.log('[agent] Files set via filechooser.');
      return true;
    } catch (e) {
      console.warn('[agent] filechooser approach failed:', (e as Error).message);
      return false;
    }
  }

  private async _tryAttachViaInput(page: Page, files: string[]): Promise<boolean> {
    try {
      const fileInput = await page.$('input[type="file"]');
      if (!fileInput) return false;
      await fileInput.setInputFiles(files);
      console.log('[agent] Files set via hidden input.');
      return true;
    } catch (e) {
      console.warn('[agent] Direct file input failed:', (e as Error).message);
      return false;
    }
  }

  private async _waitForFileChips(page: Page, expectedCount: number, timeoutMs = 20_000): Promise<void> {
    const chipSelectors = [
      '[class*="fileItem"]', '[class*="file-item"]',
      '[class*="fileChip"]', '[class*="file-chip"]',
      '[class*="attachFile"]', '[class*="attach-file"]',
      '[class*="uploadItem"]', '[class*="upload-item"]',
      '[class*="chatFile"]',
    ];
    const sel = chipSelectors.join(', ');

    const deadline = Date.now() + timeoutMs;
    // Poll more frequently for small files (faster detection), slower for large files
    const pollInterval = timeoutMs <= 3_000 ? 150 : 300;
    let stableCount = 0;
    let lastCount = -1;

    while (Date.now() < deadline) {
      await page.waitForTimeout(pollInterval);
      const count = await page.evaluate(`
        (function(sel){
          try { return document.querySelectorAll(sel).length; } catch(e) { return 0; }
        })(${JSON.stringify(sel)})
      `).catch(() => 0) as number;

      if (count >= expectedCount) {
        if (count === lastCount) stableCount++;
        else { stableCount = 0; lastCount = count; }
        // Consider stable after 2 identical readings — return quickly
        if (stableCount >= 2) {
          await page.waitForTimeout(300);
          return;
        }
      } else {
        lastCount = count;
        stableCount = 0;
      }
    }

    const finalCount = await page.evaluate(`
      (function(sel){ try { return document.querySelectorAll(sel).length; } catch(e){return 0;} })(${JSON.stringify(sel)})
    `).catch(() => 0) as number;
    // Throw so the error surfaces through the SSE stream to the extension UI
    // rather than silently continuing with an incomplete file set.
    throw new Error(`文件上传超时：仅上传 ${finalCount}/${expectedCount} 个文件，请重试`);
  }

  // ----------------------------------------------------------------
  // 等待 & 采集响应
  // ----------------------------------------------------------------

  private async resetContentMutationClock(page: Page): Promise<void> {
    await page.evaluate(contentMutationClockScript(true)).catch(() => undefined);
  }

  private async getContentQuietMs(page: Page): Promise<number> {
    const quietMs = await page.evaluate(contentMutationClockScript(false)).catch(() => RESPONSE_CONTENT_QUIET_MS) as number;
    return Number.isFinite(quietMs) ? quietMs : RESPONSE_CONTENT_QUIET_MS;
  }

  private async isGenerationBusy(page: Page): Promise<boolean> {
    const stopBtn = await findElement(page, SELECTORS.stopButton);
    if (stopBtn) return true;
    return await page.evaluate(`(function(){
      var ta = document.querySelector('textarea');
      return ta ? (ta.disabled || ta.readOnly) : false;
    })()`).catch(() => false) as boolean;
  }

  private async waitUntilGenerationIdle(page: Page, timeoutMs = GENERATION_ABORT_TIMEOUT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let stableTicks = 0;
    while (Date.now() < deadline) {
      const busy = await this.isGenerationBusy(page);
      if (!busy) {
        stableTicks++;
        if (stableTicks >= GENERATION_ABORT_STABLE_TICKS) return true;
      } else {
        stableTicks = 0;
      }
      await page.waitForTimeout(200);
    }
    return false;
  }

  private async abortActiveGeneration(
    page: Page,
    reason: string,
    trace?: DevSeekTraceLogger,
  ): Promise<void> {
    const wasBusy = await this.isGenerationBusy(page).catch(() => false);
    if (!wasBusy) return;
    trace?.info('deepseek-web', 'generation-abort-start', { reason });
    try {
      const stopBtn = await findElement(page, SELECTORS.stopButton);
      if (stopBtn) {
        await stopBtn.click();
        trace?.info('deepseek-web', 'generation-stop-clicked', { reason });
      } else {
        await page.keyboard.press('Escape').catch(() => undefined);
      }
    } catch (error) {
      trace?.error('deepseek-web', 'generation-stop-click-failed', {
        reason,
        message: (error as Error).message,
      });
    }
    const idle = await this.waitUntilGenerationIdle(page);
    trace?.info('deepseek-web', 'generation-abort-complete', { reason, idle });
  }

  private async ensureReadyForNewPrompt(
    page: Page,
    trace: DevSeekTraceLogger | undefined,
    reason: string,
  ): Promise<void> {
    if (!await this.isGenerationBusy(page).catch(() => false)) return;
    trace?.info('deepseek-web', 'generation-busy-before-submit', { reason });
    await this.abortActiveGeneration(page, reason, trace);
  }

  private async waitForResponse(
    page: Page,
    timeoutMs: number,
    onDelta?: (delta: string) => void,
    baselineAiMsgCount = 0,
    baselineText = '',
  ): Promise<string> {
    if (this.cancelRequested) throw new Error('Cancelled');

    if (onDelta) {
      return this.pollForStreamingResponse(page, timeoutMs, onDelta, baselineAiMsgCount, baselineText);
    }
    return this.waitForGenerationDone(page, timeoutMs);
  }

  /** 轮询 DOM，把新增文本通过 onDelta 推送出去 */
  private async pollForStreamingResponse(
    page: Page,
    timeoutMs: number,
    onDelta: (delta: string) => void,
    baselineAiMsgCount = 0,
    baselineText = '',
  ): Promise<string> {
    let lastText = '';
    // 累积文本：跨越多次"继续生成"后把所有轮次内容拼接
    let accumulatedPrefix = '';
    let deadline = Date.now() + timeoutMs; // let 以便续代时重置
    const absoluteTimeoutMs = responseAbsoluteTimeoutMs(timeoutMs);
    const absoluteDeadline = Date.now() + absoluteTimeoutMs;
    let sawStopButton = false;
    let stableFor = 0;
    let lastTextChangedAt = Date.now();
    // 双重门控：AI消息计数增加 OR 最后一条AI文本与baseline不同，任一触发则认为新回复已开始。
    // 原因：DeepSeek 多轮对话可能复用已有 ds-message 容器（计数不变），此时依赖文本变化检测。
    let newMsgSeen = false;
    const resumeAfterContinueClick = async (source: string): Promise<void> => {
      console.log(`[agent] Clicked "继续生成" (${source}), resuming generation...`);
      try {
        const currentRoundText = await this.getStreamingAssistantText(page);
        if (currentRoundText) {
          accumulatedPrefix = accumulatedPrefix
            ? accumulatedPrefix + '\n\n' + currentRoundText
            : currentRoundText;
        }
        sawStopButton = false;
        stableFor = 0;
        lastTextChangedAt = Date.now();
        lastText = accumulatedPrefix;
        newMsgSeen = false;
        deadline = Date.now() + timeoutMs;
        baselineAiMsgCount = await page.evaluate(`(function(){
          var msgs = document.querySelectorAll('[class*="ds-message"]');
          var c = 0;
          for (var i = 0; i < msgs.length; i++) {
            if (msgs[i].querySelectorAll('[class*="ds-markdown"]').length > 0) c++;
          }
          return c;
        })()`).catch(() => 0) as number;
        await page.waitForTimeout(CONTINUE_GENERATION_RESUME_WAIT_MS);
      } catch (e) {
        console.warn('[agent] Error after clicking continue button:', (e as Error).message);
      }
    };

    while (Date.now() < deadline && Date.now() < absoluteDeadline) {
      if (this.cancelRequested) throw new Error('Cancelled');

      if (!newMsgSeen) {
        // 方案1：AI 消息数量增加（新 ds-message 被插入）
        const aiMsgCount = await page.evaluate(`(function(){
          var msgs = document.querySelectorAll('[class*="ds-message"]');
          var c = 0;
          for (var i = 0; i < msgs.length; i++) {
            if (msgs[i].querySelectorAll('[class*="ds-markdown"]').length > 0) c++;
          }
          return c;
        })()`).catch(() => 0) as number;

        if (aiMsgCount > baselineAiMsgCount) {
          console.log(`[agent] New AI message detected (count: ${baselineAiMsgCount} → ${aiMsgCount})`);
          newMsgSeen = true;
          // 不 continue，立即进入下方内容读取
        } else {
          // 方案2：文本内容变化（DeepSeek 复用容器，计数不变但内容已更新）
          const t = await this.getStreamingAssistantText(page);
          if (t.length > 0 && t !== baselineText) {
            console.log(`[agent] New AI content detected via text diff (len: ${t.length})`);
            newMsgSeen = true;
            lastText = t;
            onDelta('\x00RESET\x00' + t);
            stableFor = 0;
            lastTextChangedAt = Date.now();
            await page.waitForTimeout(STREAM_POLL_INTERVAL_MS);
            continue;
          }
          await page.waitForTimeout(STREAM_POLL_INTERVAL_MS);
          continue;
        }
      }

      const currentText = await this.getStreamingAssistantText(page);
      const combinedText = accumulatedPrefix
        ? accumulatedPrefix + '\n\n' + currentText
        : currentText;

      if (combinedText.length > lastText.length) {
        onDelta('\x00RESET\x00' + combinedText);
        lastText = combinedText;
        stableFor = 0;
        lastTextChangedAt = Date.now();
        // Text is still growing; reset the deadline so we never time out mid-generation.
        deadline = Date.now() + timeoutMs;
      } else if (combinedText.length < lastText.length) {
        stableFor = 0;
        lastTextChangedAt = Date.now();
      } else {
        stableFor++;
      }

      // 检测并自动点击"继续生成"按钮（DeepSeek 截断长回复时出现）
      // 先快速检查，再在结束判定前给按钮一个短暂渲染窗口。
      const continueClicked = await clickContinueGenerationButton(page, SELECTORS.continueButton);
      if (continueClicked) {
        await resumeAfterContinueClick('visible');
        await page.waitForTimeout(STREAM_POLL_INTERVAL_MS);
        continue;
      }

      const generationBusy = await this.isGenerationBusy(page);

      if (generationBusy) {
        sawStopButton = true;
        stableFor = 0;
      } else if (lastText.length > 0) {
        const now = Date.now();
        const textQuietMs = now - lastTextChangedAt;
        const domQuietMs = await this.getContentQuietMs(page);
        const contentQuiet = textQuietMs >= RESPONSE_CONTENT_QUIET_MS
          && domQuietMs >= RESPONSE_CONTENT_QUIET_MS;
        const looksDone = contentQuiet && (
          (sawStopButton && stableFor >= STOP_DISAPPEARED_STABLE_TICKS)
          || stableFor >= READY_INPUT_STABLE_TICKS
        );
        if (looksDone) {
          const continuedAfterSettled = await waitAndClickContinueGenerationButton(
            page,
            SELECTORS.continueButton,
            CONTINUE_GENERATION_APPEAR_WAIT_MS,
          );
          if (continuedAfterSettled) {
            await resumeAfterContinueClick('settled');
            await page.waitForTimeout(STREAM_POLL_INTERVAL_MS);
            continue;
          }
          await page.waitForTimeout(RESPONSE_LATE_GROWTH_PROBE_MS);
          if (await this.isGenerationBusy(page)) {
            stableFor = 0;
            continue;
          }
          const probedText = await this.getStreamingAssistantText(page);
          const probedCombinedText = accumulatedPrefix
            ? accumulatedPrefix + '\n\n' + probedText
            : probedText;
          if (probedCombinedText !== lastText) {
            if (probedCombinedText.length > 0) {
              onDelta('\x00RESET\x00' + probedCombinedText);
              lastText = probedCombinedText;
            }
            stableFor = 0;
            lastTextChangedAt = Date.now();
            deadline = Date.now() + timeoutMs;
            continue;
          }
          const probedQuietMs = await this.getContentQuietMs(page);
          if (probedQuietMs < RESPONSE_CONTENT_QUIET_MS) {
            stableFor = 0;
            continue;
          }
          if (looksLikeIncompleteAssistantIntent(probedCombinedText)) {
            stableFor = 0;
            await page.waitForTimeout(INCOMPLETE_INTENT_WAIT_MS);
            if (await this.isGenerationBusy(page)) continue;
            const continuedAfterIntent = await waitAndClickContinueGenerationButton(
              page,
              SELECTORS.continueButton,
              CONTINUE_GENERATION_APPEAR_WAIT_MS,
            );
            if (continuedAfterIntent) {
              await resumeAfterContinueClick('incomplete-intent');
              continue;
            }
            const intentProbeText = await this.getStreamingAssistantText(page);
            const intentCombinedText = accumulatedPrefix
              ? accumulatedPrefix + '\n\n' + intentProbeText
              : intentProbeText;
            if (intentCombinedText !== probedCombinedText) {
              if (intentCombinedText.length > 0) {
                onDelta('\x00RESET\x00' + intentCombinedText);
                lastText = intentCombinedText;
              }
              lastTextChangedAt = Date.now();
              deadline = Date.now() + timeoutMs;
              continue;
            }
          }
          break;
        }
      }

      await page.waitForTimeout(STREAM_POLL_INTERVAL_MS);
    }

    if (Date.now() >= absoluteDeadline) {
      await this.abortActiveGeneration(page, 'streaming-absolute-deadline');
      throw responseStreamTimeoutError({
        timeoutMs,
        absoluteTimeoutMs,
        partialChars: lastText.length,
        newMessageSeen: newMsgSeen,
        phase: 'streaming-absolute-deadline',
      });
    }
    if (Date.now() >= deadline) {
      await this.abortActiveGeneration(page, 'streaming-idle-deadline');
      throw responseStreamTimeoutError({
        timeoutMs,
        absoluteTimeoutMs,
        partialChars: lastText.length,
        newMessageSeen: newMsgSeen,
        phase: 'streaming-idle-deadline',
      });
    }

    await this._clickCodeTabs(page);
    await this._dumpLastMsg(page);
    const postText = await this.getLastAssistantText(page);
    const finalText = accumulatedPrefix
      ? accumulatedPrefix + '\n\n' + postText
      : postText;
    // Only fire the final RESET if we actually saw a new AI message.
    // Without this guard, a timed-out request (newMsgSeen=false) would read
    // the previous response from the DOM and replay it as the current response.
    if (newMsgSeen && finalText.length > 0 && finalText !== lastText) {
      onDelta('\x00RESET\x00' + finalText);
      lastText = finalText;
    }

    await saveCookies(this.context!);
    return lastText;
  }

  /** 等待生成完成后读取最终文本（非流式模式）*/
  private async waitForGenerationDone(page: Page, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    const absoluteTimeoutMs = responseAbsoluteTimeoutMs(timeoutMs);
    const absoluteDeadline = Date.now() + absoluteTimeoutMs;
    let lastObservedText = '';
    let lastTextChangedAt = Date.now();

    // 先等 textarea 进入禁用状态（DeepSeek 开始生成时禁用输入框）
    const waitStart = Date.now();
    while (Date.now() - waitStart < 30_000) {
      const disabled = await page.evaluate(`(function(){
        var ta = document.querySelector('textarea');
        return ta ? (ta.disabled || ta.readOnly) : false;
      })()`).catch(() => false) as boolean;
      if (disabled) break;
      await page.waitForTimeout(150);
    }

    // 等待 textarea 恢复可用（生成结束），同时检测"继续生成"按钮
    while (Date.now() < deadline && Date.now() < absoluteDeadline) {
      if (this.cancelRequested) throw new Error('Cancelled');
      const busy = await this.isGenerationBusy(page);
      const currentText = await this.getStreamingAssistantText(page).catch(() => '');
      if (currentText !== lastObservedText) {
        lastObservedText = currentText;
        lastTextChangedAt = Date.now();
      }
      if (!busy) {
        // textarea 变为可用：可能是生成完成，也可能是"继续生成"等待用户操作
        const continued = await waitAndClickContinueGenerationButton(
          page,
          SELECTORS.continueButton,
          CONTINUE_GENERATION_APPEAR_WAIT_MS,
        );
        if (continued) {
          console.log('[agent] waitForGenerationDone: clicked "继续生成", waiting again...');
          await this.resetContentMutationClock(page);
          lastTextChangedAt = Date.now();
          await page.waitForTimeout(800);
          continue; // 继续等待新一轮生成
        }
        const textQuietMs = Date.now() - lastTextChangedAt;
        const domQuietMs = await this.getContentQuietMs(page);
        if (textQuietMs >= RESPONSE_CONTENT_QUIET_MS && domQuietMs >= RESPONSE_CONTENT_QUIET_MS) {
          await page.waitForTimeout(RESPONSE_LATE_GROWTH_PROBE_MS);
          const afterProbeText = await this.getStreamingAssistantText(page).catch(() => '');
          if (afterProbeText === lastObservedText && !(await this.isGenerationBusy(page))) {
            const probeQuietMs = await this.getContentQuietMs(page);
            if (probeQuietMs >= RESPONSE_CONTENT_QUIET_MS && !looksLikeIncompleteAssistantIntent(afterProbeText)) break; // 真正完成
            if (looksLikeIncompleteAssistantIntent(afterProbeText)) {
              await page.waitForTimeout(INCOMPLETE_INTENT_WAIT_MS);
              const afterIntentText = await this.getStreamingAssistantText(page).catch(() => '');
              if (afterIntentText !== afterProbeText || await this.isGenerationBusy(page)) {
                lastObservedText = afterIntentText;
                lastTextChangedAt = Date.now();
                continue;
              }
            }
          }
          lastObservedText = afterProbeText;
          lastTextChangedAt = Date.now();
        }
      }
      await page.waitForTimeout(200);
    }

    if (Date.now() >= absoluteDeadline || Date.now() >= deadline) {
      await this.abortActiveGeneration(page, Date.now() >= absoluteDeadline ? 'nonstream-absolute-deadline' : 'nonstream-idle-deadline');
      throw responseStreamTimeoutError({
        timeoutMs,
        absoluteTimeoutMs,
        partialChars: lastObservedText.length,
        newMessageSeen: lastObservedText.length > 0,
        phase: Date.now() >= absoluteDeadline ? 'nonstream-absolute-deadline' : 'nonstream-idle-deadline',
      });
    }

    console.log('[agent] Response complete.');
    await this._clickCodeTabs(page);
    await this._dumpLastMsg(page);
    const text = await this.getLastAssistantText(page);
    await saveCookies(this.context!);
    return text;
  }

  /** 点击最后一条 AI 消息中所有"代码"标签页，让代码面板加载到 DOM 中。
   * 必须用 Playwright 的 locator.click()，不能用 page.evaluate 里的 el.click()，
   * 因为 DeepSeek 使用 React 合成事件，原生 DOM click() 不会触发 Tab 切换逻辑。
   */
  private async _clickCodeTabs(page: Page): Promise<void> {
    try {
      // 找到所有 role="tab"、直接文本为"代码"、且当前未选中的标签
      const tabs = page.locator('[role="tab"]').filter({ hasText: /^代码/ });
      const count = await tabs.count().catch(() => 0);
      let clicked = false;
      for (let i = 0; i < count; i++) {
        try {
          const tab = tabs.nth(i);
          const selected = await tab.getAttribute('aria-selected').catch(() => 'true');
          if (selected !== 'true') {
            await tab.click({ force: true, timeout: 2000 });
            clicked = true;
            await page.waitForTimeout(CODE_TAB_RENDER_WAIT_MS);
          }
        } catch { /* ignore individual tab errors */ }
      }
      if (clicked) await page.waitForTimeout(CODE_TAB_RENDER_WAIT_MS);
    } catch { /* ignore */ }
  }

  /** 将最后一条 AI 消息的 innerHTML dump 到 /tmp/bridge_diag.log */
  private async _dumpLastMsg(page: Page): Promise<void> {
    if (process.env.DEVSEEK_BRIDGE_DIAG !== '1') return;
    try {
      const html = await page.evaluate(`(function(){
        var msgs = document.querySelectorAll('[class*="ds-message"]');
        if (!msgs.length) return 'NO_MSGS';
        var last = msgs[msgs.length - 1];
        var codeEls = Array.prototype.slice.call(last.querySelectorAll('pre, code, textarea'));
        var codeSnap = codeEls.slice(0,6).map(function(el){
          return el.tagName + ': ' + (el.textContent||'').slice(0,120);
        });
        return JSON.stringify({ codeSnap: codeSnap, html: last.innerHTML.slice(0, 5000) });
      })()`) as string;
      require('fs').appendFileSync('/tmp/bridge_diag.log',
        new Date().toISOString() + ' [final-dump]\n' + html + '\n\n');
    } catch { /* ignore */ }
  }

  /** 生成中使用的轻量文本快照。
   * 完整 Markdown/代码块还原留到最终阶段做，避免流式轮询被重型 DOM 转换拖慢。
   */
  private async getStreamingAssistantText(page: Page): Promise<string> {
    try {
      const text = await page.evaluate(`(function(){
        function isVisible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          return !style || (style.display !== 'none' && style.visibility !== 'hidden');
        }

        function cleanText(el) {
          var clone = el.cloneNode(true);
          var noisy = clone.querySelectorAll(
            'button, style, script, svg, [class*="copy"], [class*="toolbar"], ' +
            '[class*="action"], [class*="cite"], [class*="citation"], ' +
            '[class*="reference"], [class*="footnote"]'
          );
          for (var i = 0; i < noisy.length; i++) noisy[i].remove();
          return (clone.innerText || clone.textContent || '')
            .replace(/\\u00a0/g, ' ')
            .replace(/[ \\t]+\\n/g, '\\n')
            .trim();
        }

        function hasAssistantContent(el) {
          return !!(el && el.querySelector && el.querySelector(
            '[class*="ds-markdown"], [class*="markdown-body"], [class*="markdown"], pre, code, table, p, ol, ul'
          ));
        }

        var seen = [];
        var candidates = [];
        function add(el) {
          if (!el || seen.indexOf(el) >= 0 || !isVisible(el) || !hasAssistantContent(el)) return;
          seen.push(el);
          var text = cleanText(el);
          if (text) candidates.push(text);
        }

        var messages = document.querySelectorAll('[class*="ds-message"]');
        for (var mi = 0; mi < messages.length; mi++) add(messages[mi]);

        var markdown = document.querySelectorAll('[class*="ds-markdown"], [class*="markdown-body"], [class*="markdown"]');
        for (var i = 0; i < markdown.length; i++) {
          var root = markdown[i].closest('[class*="ds-message"], [data-role="assistant"], [class*="assistant"], [class*="bot"]') || markdown[i];
          add(root);
        }

        if (candidates.length === 0) {
          var assistantRoots = document.querySelectorAll('[data-role="assistant"], div[class*="assistant"], div[class*="bot"]');
          for (var ai = 0; ai < assistantRoots.length; ai++) add(assistantRoots[ai]);
        }

        return candidates.length ? candidates[candidates.length - 1] : '';
      })()`);
      return extractDeepSeekResponse({ assistantMessages: [String(text || '')] }).lastAnswer;
    } catch { /* ignore */ }
    return '';
  }

  private _diagnosticDone = false;

  /** 提取最后一条 AI 消息的纯文本（Markdown 格式）。
   * Mermaid 图表以 ```mermaid 代码块形式返回，由 webview 端 mermaid.js 渲染。
   */
  private async getLastAssistantText(page: Page): Promise<string> {
    // 一次性诊断：记录 DOM 结构，便于调试 Mermaid 提取问题
    if (process.env.DEVSEEK_BRIDGE_DIAG === '1' && !this._diagnosticDone) {
      this._diagnosticDone = true;
      try {
        const diagInfo = await page.evaluate(`(function(){
          var msgs = document.querySelectorAll('[class*="ds-message"]');
          var lastMsg = null;
          for (var i = msgs.length-1; i>=0; i--) {
            if (msgs[i].querySelectorAll('[class*="ds-markdown"]').length > 0) { lastMsg = msgs[i]; break; }
          }
          if (!lastMsg) return 'NO_MSG';
          var svgs = Array.prototype.slice.call(lastMsg.querySelectorAll('svg'), 0, 4);
          var pres = Array.prototype.slice.call(lastMsg.querySelectorAll('pre'), 0, 4);
          var codes = Array.prototype.slice.call(lastMsg.querySelectorAll('code'), 0, 4);
          var childTags = Array.prototype.map.call(lastMsg.childNodes, function(n){ return (n.tagName||'text')+':'+(n.getAttribute?((n.getAttribute('class')||'').slice(0,30)):''); });
          return JSON.stringify({
            childTags: childTags,
            svgs: svgs.map(function(s){ return {id:s.id,aria:s.getAttribute('aria-roledescription')||'',cls:(s.getAttribute('class')||'').slice(0,60)}; }),
            pres: pres.map(function(p){ return {cls:(p.getAttribute('class')||'').slice(0,60),txt:(p.textContent||'').slice(0,80)}; }),
            codes: codes.map(function(c){ return {cls:(c.getAttribute('class')||'').slice(0,60),txt:(c.textContent||'').slice(0,80)}; }),
            html: lastMsg.innerHTML.slice(0, 3000)
          });
        })()`);
        require('fs').appendFileSync('/tmp/bridge_diag.log', new Date().toISOString() + '\n' + diagInfo + '\n\n');
        console.log('[agent][diag] written to /tmp/bridge_diag.log');
      } catch { /* ignore */ }
    }

    try {
      const text = await page.evaluate(`(function(){

        // PRE-PASS：扫描所有 pre/code，识别 mermaid 内容，在最近含 SVG 的祖先上打标记
        // 这样 htmlToMd 遇到标记元素时直接返回代码块，跳过内部 Tab 按钮文字和 SVG
        function preMermaid(root) {
          if (!root || !root.querySelectorAll) return;
          // 1. 清理上次遗留的错误标记（流式阶段可能用行内 <code> 错误打标）
          var oldTagged = Array.prototype.slice.call(root.querySelectorAll('[data-netai-mermaid]'));
          oldTagged.forEach(function(el) { el.removeAttribute('data-netai-mermaid'); });
          if (root.removeAttribute) root.removeAttribute('data-netai-mermaid');

          var MERMAID_RE = /^(sequenceDiagram|graph |flowchart |classDiagram|stateDiagram|erDiagram|journey|gantt|pie |gitGraph|mindmap|timeline|C4Context|quadrantChart|xychart|block-beta)/i;
          // 2. 只扫 <pre>，不扫行内 <code>（行内 <code>sequenceDiagram</code> 是关键词引用，不是图表源码）
          // 3. 要求内容含换行（真正的代码块，而非单行关键字）
          var els = Array.prototype.slice.call(root.querySelectorAll('pre'));
          els.forEach(function(el) {
            var ct = (el.textContent || '').trim();
            if (ct.length < 5 || ct.indexOf('\\n') < 0 || !MERMAID_RE.test(ct)) return;
            // 找到 mermaid 代码：向上寻找含 SVG 或 [role="tablist"] 的最近祖先
            // （点击"代码"标签后 SVG 可能已卸载，改用 tablist 判断图表容器）
            var container = el.parentElement;
            for (var d = 0; d < 12 && container && container !== root; d++) {
              var hasSvg = container.querySelector && container.querySelector('svg');
              var hasTabs = container.querySelector && container.querySelector('[role="tablist"]');
              if (hasSvg || hasTabs) {
                container.setAttribute('data-netai-mermaid', ct);
                return;
              }
              container = container.parentElement;
            }
          });
        }

        // 将 HTML 节点逆向还原为 Markdown 文本
        function htmlToMd(node) {
          if (!node) return '';
          if (node.nodeType === 3) return node.textContent || ''; // Text node
          var tag = (node.tagName || '').toLowerCase();

          // Mermaid 容器（PRE-PASS 已标记）：直接返回代码块，跳过内部所有子节点
          var mermaidCode = node.getAttribute ? node.getAttribute('data-netai-mermaid') : null;
          if (mermaidCode !== null) {
            return '\\n\\n\`\`\`mermaid\\n' + mermaidCode.replace(/\\n$/, '') + '\\n\`\`\`\\n\\n';
          }

          // 内联 mermaid 检测（兜底）：仅对 class 含"code-block"的节点触发
          // 即 DeepSeek 的 md-code-block 容器，而非 ds-markdown 等高层元素
          // 避免在 ds-markdown 层误匹配段落里的行内 <code> 关键字
          var nodeCls = node.getAttribute ? (node.getAttribute('class') || '') : '';
          if (nodeCls.indexOf('code-block') >= 0) {
            var MERMAID_INLINE = /^(sequenceDiagram|graph |flowchart |classDiagram|stateDiagram|erDiagram|journey|gantt|pie |gitGraph|mindmap|timeline|C4Context|quadrantChart|xychart|block-beta)/i;
            var preTags = Array.prototype.slice.call(node.querySelectorAll('pre'));
            for (var nki = 0; nki < preTags.length; nki++) {
              var nct = (preTags[nki].textContent || '').trim();
              if (nct.length > 5 && nct.indexOf('\\n') >= 0 && MERMAID_INLINE.test(nct)) {
                return '\\n\\n\`\`\`mermaid\\n' + nct.replace(/\\n$/, '') + '\\n\`\`\`\\n\\n';
              }
            }
          }

          // 跳过上标（通常是脚注/引用序号）
          if (tag === 'sup') return '';
          // 先过滤无内容标签（SVG 元素的 className 是 SVGAnimatedString 对象，不能调用 .indexOf）
          if (tag === 'button' || tag === 'style' || tag === 'script') return '';
          // SVG：全部跳过（Mermaid 由 PRE-PASS + data-netai-mermaid 处理）
          if (tag === 'svg') return '';
          // 跳过 DeepSeek 深度搜索的行内引用标记
          var elCls = (node.getAttribute ? (node.getAttribute('class') || '') : '');
          if (elCls && (elCls.indexOf('cite') >= 0 || elCls.indexOf('citation') >= 0 || elCls.indexOf('footnote') >= 0 || elCls.indexOf('reference') >= 0)) return '';
          // 跳过内容仅为 -N 或 -N-M 的元素（DeepSeek 来源角标，如 -2-9）
          var citeTxt = (node.textContent || '').replace(/[\\s]+/g, '');
          if (/^(-[0-9]{1,3})+$/.test(citeTxt)) return '';

          // 跳过代码块头部（语言标签 + 复制/下载按钮），它们是 <pre> 的兄弟节点
          if (tag !== 'pre' && node.parentElement) {
            var sibs = node.parentElement.children;
            for (var si = 0; si < sibs.length; si++) {
              if ((sibs[si].tagName || '').toLowerCase() === 'pre' && sibs[si] !== node) {
                return ''; // 这是代码工具栏元素，跳过
              }
            }
          }

          // 表格：遍历 tr → 过滤直接子 th/td → textContent 获取内容
          if (tag === 'table') {
            var rows = Array.prototype.slice.call(node.querySelectorAll('tr'));
            if (!rows.length) return '';
            var getCells = function(row) {
              return Array.prototype.filter.call(row.children, function(el) {
                var t = (el.tagName || '').toLowerCase();
                return t === 'th' || t === 'td';
              });
            };
            var firstCells = getCells(rows[0]);
            if (!firstCells.length) return '';
            var colCount = firstCells.length;
            var mdRows = rows.map(function(row) {
              var cells = getCells(row);
              return '| ' + cells.map(function(c) {
                var cellText = Array.prototype.map.call(c.childNodes, function(n) { return htmlToMd(n); }).join('');
                return cellText.replace(/\\s+/g, ' ').replace(/\\|/g, '\\\\|').trim();
              }).join(' | ') + ' |';
            });
            var sep = '|' + Array(colCount + 1).join(' --- |');
            mdRows.splice(1, 0, sep);
            return '\\n\\n' + mdRows.join('\\n') + '\\n\\n';
          }

          var children = Array.prototype.map.call(node.childNodes, htmlToMd).join('');
          // 跳过已经被 table 处理的子元素
          if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'tr' || tag === 'th' || tag === 'td') return children;

          // 代码块（pre > code）
          if (tag === 'pre') {
            var codeEl = node.querySelector('code');
            var lang = '';
            if (codeEl) {
              var cls = codeEl.className || '';
              var m = cls.match(/language-(\\w+)/);
              if (m) lang = m[1];
            }
            var code = (codeEl ? codeEl.textContent : node.textContent) || '';
            return '\\n\\n\`\`\`' + lang + '\\n' + code.replace(/\\n$/, '') + '\\n\`\`\`\\n\\n';
          }
          // 内联代码
          if (tag === 'code') return '\`' + (node.textContent || '') + '\`';
          // 标题
          if (tag === 'h1') return '\\n\\n# ' + children + '\\n\\n';
          if (tag === 'h2') return '\\n\\n## ' + children + '\\n\\n';
          if (tag === 'h3') return '\\n\\n### ' + children + '\\n\\n';
          if (tag === 'h4') return '\\n\\n#### ' + children + '\\n\\n';
          // 粗体/斜体
          if (tag === 'strong' || tag === 'b') return '**' + children + '**';
          if (tag === 'em' || tag === 'i') return '*' + children + '*';
          // 段落
          if (tag === 'p') return children + '\\n\\n';
          // 列表
          if (tag === 'ul') return children + '\\n';
          if (tag === 'ol') {
            var idx = 0;
            return Array.prototype.map.call(node.childNodes, function(n) {
              if ((n.tagName||'').toLowerCase() === 'li') { idx++; return idx + '. ' + htmlToMd(n).trim() + '\\n'; }
              return htmlToMd(n);
            }).join('') + '\\n';
          }
          if (tag === 'li') return '- ' + children.trim() + '\\n';
          // 水平线
          if (tag === 'hr') return '\\n\\n---\\n\\n';
          // 引用
          if (tag === 'blockquote') return children.split('\\n').map(function(l){return '> '+l;}).join('\\n') + '\\n\\n';
          if (tag === 'button' || tag === 'svg' || tag === 'style' || tag === 'script') return '';
          return children;
        }

        // 从后往前找最后一个含 ds-markdown 的 ds-message（AI 气泡）
        var messages = document.querySelectorAll('[class*="ds-message"]');
        var lastMsg = null;
        for (var mi = messages.length - 1; mi >= 0; mi--) {
          if (messages[mi].querySelectorAll('[class*="ds-markdown"]').length > 0) {
            lastMsg = messages[mi]; break;
          }
        }

        // PRE-PASS：在实际 DOM 上标记 mermaid 容器（不需要 clone）
        if (lastMsg) preMermaid(lastMsg);

        // 遍历 lastMsg 的全部直接子节点（DOM 顺序），同时处理 ds-markdown 和 mermaid widget 兄弟节点
        if (lastMsg) {
          var parts = [];
          var directChildren = Array.prototype.slice.call(lastMsg.childNodes);
          for (var ci = 0; ci < directChildren.length; ci++) {
            var r = htmlToMd(directChildren[ci]);
            if (r) parts.push(r);
          }
          var joined = parts.join('').replace(/\\n{3,}/g, '\\n\\n').trim();
          if (joined) return joined;
        }

        // 回退：取最后一个根级 ds-markdown
        var allMd = document.querySelectorAll('[class*="ds-markdown"]');
        if (allMd.length > 0) {
          var allRoot = Array.prototype.filter.call(allMd, function(el) {
            var p = el.parentElement;
            while (p) {
              var pc = p.getAttribute ? (p.getAttribute('class') || '') : '';
              if (pc.indexOf('ds-markdown') >= 0) return false;
              p = p.parentElement;
            }
            return true;
          });
          var allContent = Array.prototype.filter.call(allRoot, function(el) {
            var c = el.getAttribute ? (el.getAttribute('class') || '') : '';
            return c.indexOf('cite') < 0 && c.indexOf('reference') < 0;
          });
          var fb = allContent.length > 0 ? allContent : allRoot;
          if (fb.length > 0) {
            return htmlToMd(fb[fb.length - 1]).replace(/\\n{3,}/g, '\\n\\n').trim();
          }
        }
        return '';
      })()`);
      return extractDeepSeekResponse({ assistantMessages: [String(text || '')] }).lastAnswer;
    } catch { /* ignore */ }
    return '';
  }

  // ----------------------------------------------------------------
  // 会话管理
  // ----------------------------------------------------------------

  private async startNewSession(): Promise<void> {
    const page = this.requirePage();
    console.log('[agent] Starting new session...');
    try {
      const btn = await findElement(page, SELECTORS.newChatButton);
      if (btn) {
        await btn.click();
      } else {
        await page.goto(DEEPSEEK_URL, { waitUntil: 'domcontentloaded' });
      }
      await page.waitForTimeout(1200);
    } catch (e) {
      console.warn('[agent] New session failed, continuing:', (e as Error).message);
    }
  }

  // ----------------------------------------------------------------
  // 取消 / 关闭
  // ----------------------------------------------------------------

  cancel(): void {
    this.cancelRequested = true;
    if (this.page) {
      findElement(this.page, SELECTORS.stopButton)
        .then((btn) => btn?.click())
        .catch(() => {});
    }
    console.log('[agent] Cancel requested.');
  }

  async close(): Promise<void> {
    if (this.context) {
      try { await this.context.close(); } catch { /* ignore */ }
      this.context = null;
      this.page = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
    }
  }

  // ----------------------------------------------------------------
  // 状态
  // ----------------------------------------------------------------

  get isReady(): boolean {
    return this.page !== null;
  }

  // ----------------------------------------------------------------
  // 内部工具
  // ----------------------------------------------------------------

  private requirePage(): Page {
    if (!this.page) throw new Error('Agent not initialized. Call init() first.');
    return this.page;
  }
}

function buildInlineFileContext(files: readonly string[]): string | undefined {
  const maxFileBytes = 64 * 1024;
  const maxTotalChars = 120_000;
  const sections: string[] = [];
  let totalChars = 0;

  for (const file of files) {
    let content: string;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      const bytesToRead = Math.min(stat.size, maxFileBytes);
      const fd = fs.openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buffer, 0, bytesToRead, 0);
        content = buffer.toString('utf8');
        if (stat.size > maxFileBytes) {
          content += `\n...[truncated by DevSeek Bridge: ${stat.size} bytes total]`;
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      continue;
    }

    const language = languageForFile(file);
    const section = [
      `<devseek-file path="${file}">`,
      `\`\`\`${language}`,
      content.replace(/\s+$/g, ''),
      '```',
      '</devseek-file>',
    ].join('\n');

    if (totalChars + section.length > maxTotalChars) {
      sections.push('[DevSeek Bridge omitted additional files because the inline context budget was reached.]');
      break;
    }
    sections.push(section);
    totalChars += section.length;
  }

  if (sections.length === 0) return undefined;
  return [
    'DevSeek Bridge could not use the DeepSeek Web file-upload control in this session.',
    'It is inlining the selected workspace files below as read-only context.',
    'Use these files only as context; return the requested DevSeek file tool call for edits.',
    '',
    ...sections,
  ].join('\n');
}

function languageForFile(file: string): string {
  const ext = nodePath.extname(file).toLowerCase();
  const languages: Record<string, string> = {
    '.c': 'c',
    '.cc': 'cpp',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.h': 'cpp',
    '.hpp': 'cpp',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.json': 'json',
    '.mjs': 'javascript',
    '.py': 'python',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.yml': 'yaml',
    '.yaml': 'yaml',
  };
  return languages[ext] ?? '';
}
