/**
 * DeepSeek 网页版 DOM 选择器配置
 *
 * 若 DeepSeek 更新 UI 导致自动化失效，在此修改对应选择器。
 * 查找方式：打开 https://chat.deepseek.com/，开启 DevTools (F12)，
 * 在 Console 中执行 document.querySelector('<selector>') 验证。
 */
export const SELECTORS = {
  /** 聊天输入框 */
  chatInput: [
    'textarea#chat-input',
    'textarea[placeholder]',
    'div[contenteditable="true"][class*="input"]',
    'div[contenteditable="true"]',
    'textarea',
  ],

  /** 发送/提交按钮 */
  sendButton: [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send"]',
    'button[type="submit"]',
    'div[class*="input"] button:last-child',
  ],

  /** 停止生成按钮（AI 输出中才会出现）*/
  stopButton: [
    'button[aria-label="Stop"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[class*="stop"]',
    'div[class*="stop"]',
    'button[aria-label="停止"]',
    // 注意：不要加 'div[class*="inputActions"] button:not([disabled])'
    // 该选择器会匹配发送键，导致 stableFor 永远被重置、循环跑满超时
  ],

  /** 新建对话按钮 */
  newChatButton: [
    'button[aria-label="New chat"]',
    'button[aria-label*="New"]',
    'a[href="/"]',
    'button[class*="new-chat"]',
    'div[class*="new-chat"]',
  ],

  /** AI 回复内容区域（取最后一个即最新回复）*/
  assistantMessage: [
    '[class*="ds-markdown"]',   // DeepSeek 主要回复容器
    '[class*="markdown-body"]',
    'div[class*="assistant"] [class*="content"]',
    'div[class*="message"][class*="assistant"]',
    'div[data-role="assistant"] [class*="content"]',
    'div[class*="bot"] div[class*="text"]',
  ],

  /** 页面加载完成后才出现的元素（判断已登录）*/
  loggedInIndicator: [
    'textarea',
    'div[contenteditable="true"]',
    '[class*="chat-input"]',
  ],

  /**
   * DeepThink (R1) 切换按钮 — 点击激活深度思考模式
   * 已激活时再次点击则关闭（回到 V3 快速模式）
   * 查找方式：DevTools → 找 DeepThink / R1 相关按钮
   */
  deepThinkButton: [
    'div[class*="deepThink"]',
    'div[class*="deep-think"]',
    '[class*="deepThink"] button',
    'button[aria-label*="DeepThink"]',
    'button[aria-label*="Deep Think"]',
    'button[aria-label*="R1"]',
    // 通用文本匹配备选（Playwright text selector）
    'text=DeepThink',
    'text=Deep Think',
  ],

  /**
   * 文件附件按钮（点击后会弹出文件选择器）
   */
  attachButton: [
    'div[class*="uploadBtn"]',
    'div[class*="upload-btn"]',
    'div[class*="fileUpload"]',
    'label[class*="upload"]',
    'button[aria-label*="上传"]',
    'button[aria-label*="attach"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="upload"]',
    'button[aria-label*="Upload"]',
    'span[class*="uploadIcon"]',
    'div[class*="chatInputActions"] button:first-child',
  ],

  /**
   * DeepThink 按钮激活状态判断（已激活时有 active/selected class 或 aria-pressed=true）
   */
  deepThinkActive: [
    'div[class*="deepThink"][class*="active"]',
    'div[class*="deepThink"][class*="selected"]',
    'div[class*="deepThink"][class*="checked"]',
    'button[aria-pressed="true"][aria-label*="DeepThink"]',
    'button[aria-pressed="true"][aria-label*="Deep Think"]',
  ],

  /**
   * DeepSeek "继续生成" 按钮 — 长回复被截断时出现，点击后继续输出
   * 查找方式：DevTools → 观察回复底部按钮文字
   */
  continueButton: [
    'button:has-text("继续生成")',
    'button:has-text("Continue")',
    'div[class*="continueBtn"]',
    'div[class*="continue-btn"]',
    'button[class*="continue"]',
  ],
} as const;

/** DeepSeek 网页 URL */
export const DEEPSEEK_URL = 'https://chat.deepseek.com/';

/** Cookie / 状态文件存储目录 */
export const DATA_DIR = process.env.DEEPSEEK_DATA_DIR
  || require('path').join(process.env.HOME || process.cwd(), '.devseek-netai');
