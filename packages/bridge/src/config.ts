export { DEEPSEEK_DOM_SELECTORS, SELECTORS } from './deepseek-dom-selectors';

/** DeepSeek 网页 URL */
export const DEEPSEEK_URL = 'https://chat.deepseek.com/';

/** Cookie / 状态文件存储目录 */
export const DATA_DIR = process.env.DEEPSEEK_DATA_DIR
  || require('path').join(process.env.HOME || process.cwd(), '.devseek-netai');
