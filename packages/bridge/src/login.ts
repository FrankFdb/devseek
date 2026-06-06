/**
 * 首次登录辅助脚本
 * 运行：npm run login --workspace=packages/bridge
 *
 * 用途：单独打开浏览器，等待手动完成 DeepSeek 登录后保存 Cookie，
 * 后续 bridge server 启动时无需再次登录。
 */
import { chromium } from 'playwright';
import { getStorageStatePath, loadCookies, saveCookies } from './session';
import { DEEPSEEK_URL, SELECTORS } from './config';

async function main() {
  console.log('=== DeepSeek NetAI — 首次登录向导 ===');
  console.log('浏览器即将打开，请手动完成登录...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const storageState = getStorageStatePath();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ...(storageState ? { storageState } : {}),
  });

  await context.addInitScript(
    `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`,
  );

  if (!storageState) await loadCookies(context);
  const page = await context.newPage();
  await page.goto(DEEPSEEK_URL, { waitUntil: 'domcontentloaded' });

  // 等待聊天输入框出现，说明已登录
  console.log('等待登录完成（最多 5 分钟）...');
  const selectors = SELECTORS.loggedInIndicator;
  const start = Date.now();
  const timeout = 300_000;

  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        console.log('\n✅ 登录成功！正在保存 Cookie...');
        await saveCookies(context);
        console.log('✅ Cookie 已保存，可以关闭浏览器了。');
        await browser.close();
        process.exit(0);
      }
    }
    await page.waitForTimeout(1000);
  }

  console.error('❌ 登录超时，请重新运行此脚本。');
  await browser.close();
  process.exit(1);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
