import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext } from 'playwright';
import { DATA_DIR } from './config';

const COOKIES_FILE = path.join(DATA_DIR, 'cookies.json');
const STORAGE_STATE_FILE = path.join(DATA_DIR, 'storage-state.json');

export function getStorageStatePath(): string | undefined {
  return fs.existsSync(STORAGE_STATE_FILE) ? STORAGE_STATE_FILE : undefined;
}

export async function loadCookies(context: BrowserContext): Promise<boolean> {
  try {
    if (fs.existsSync(STORAGE_STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STORAGE_STATE_FILE, 'utf-8'));
      if (Array.isArray(state?.cookies) && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
        return true;
      }
    }
    if (!fs.existsSync(COOKIES_FILE)) return false;
    const raw = fs.readFileSync(COOKIES_FILE, 'utf-8');
    const cookies = JSON.parse(raw);
    if (Array.isArray(cookies) && cookies.length > 0) {
      await context.addCookies(cookies);
      return true;
    }
  } catch (e) {
    console.warn('[session] Failed to load cookies:', e);
  }
  return false;
}

export async function saveCookies(context: BrowserContext): Promise<void> {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const state = await context.storageState();
    const now = Math.floor(Date.now() / 1000);
    // 会话cookie（expires=-1）无法跨浏览器实例传递，将其有效期延长初 7 天
    const persisted = state.cookies.map(c => ({
      ...c,
      expires: (!c.expires || c.expires < 0) ? now + 7 * 24 * 3600 : c.expires,
    }));
    const persistedState = { ...state, cookies: persisted };
    fs.writeFileSync(STORAGE_STATE_FILE, JSON.stringify(persistedState, null, 2));
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(persisted, null, 2));
    console.log(`[session] Saved storage state with ${persisted.length} cookies.`);
  } catch (e) {
    console.warn('[session] Failed to save storage state:', e);
  }
}

export function hasSavedCookies(): boolean {
  return fs.existsSync(STORAGE_STATE_FILE) || fs.existsSync(COOKIES_FILE);
}
