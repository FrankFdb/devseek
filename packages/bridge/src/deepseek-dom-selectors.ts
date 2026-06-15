/**
 * DeepSeek 网页版 DOM 选择器配置。
 *
 * 若 DeepSeek 更新 UI 导致自动化失效，在此修改对应选择器。
 * 查找方式：打开 https://chat.deepseek.com/，开启 DevTools (F12)，
 * 在 Console 中执行 document.querySelector('<selector>') 验证。
 */
export const DEEPSEEK_DOM_SELECTORS = {
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
    // 不要添加 'div[class*="inputActions"] button:not([disabled])'：
    // 它会匹配发送按钮，导致 stableFor 永远被重置、循环跑满超时。
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
    '[class*="ds-markdown"]',
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

  /** DeepThink (R1) 切换按钮 */
  deepThinkButton: [
    'div[class*="deepThink"]',
    'div[class*="deep-think"]',
    '[class*="deepThink"] button',
    'button[aria-label*="DeepThink"]',
    'button[aria-label*="Deep Think"]',
    'button[aria-label*="R1"]',
    'text=DeepThink',
    'text=Deep Think',
  ],

  /** 文件附件按钮 */
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

  /** DeepThink 按钮激活状态判断 */
  deepThinkActive: [
    'div[class*="deepThink"][class*="active"]',
    'div[class*="deepThink"][class*="selected"]',
    'div[class*="deepThink"][class*="checked"]',
    'button[aria-pressed="true"][aria-label*="DeepThink"]',
    'button[aria-pressed="true"][aria-label*="Deep Think"]',
  ],

  /** DeepSeek "继续生成" 按钮 */
  continueButton: [
    'button:has-text("继续生成")',
    'button:has-text("Continue")',
    'div[class*="continueBtn"]',
    'div[class*="continue-btn"]',
    'button[class*="continue"]',
  ],
} as const;

export const SELECTORS = DEEPSEEK_DOM_SELECTORS;
