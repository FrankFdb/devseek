import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../../');

function read(relPath) {
  return readFileSync(path.join(extensionRoot, relPath), 'utf8');
}

test('R3-08C WebView accessibility surfaces expose keyboard, focus, and screen-reader status', () => {
  const html = read('src/ui/webview-html.ts');
  const webview = read('media/webview.js');

  assert.match(html, /id="messages"[^>]*role="log"[^>]*aria-live="polite"/, 'message log must be a live log region');
  assert.match(html, /id="a11y-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/, 'screen-reader status region is required');
  assert.match(html, /id="status-bar"[^>]*role="status"/, 'visible connection status must expose status semantics');
  assert.match(html, /id="input"[^>]*aria-label=/, 'prompt input must have an accessible label');
  assert.match(html, /id="send-btn"[^>]*aria-label=/, 'send button must have an accessible label');
  assert.match(html, /id="agent-toggle-btn"[^>]*aria-pressed=/, 'agent mode toggle must expose pressed state');
  assert.match(html, /id="autopilot-btn"[^>]*aria-pressed=/, 'autopilot toggle must expose pressed state');
  assert.match(html, /#ready-progress \.bar \{[^}]*width: 100%;[^}]*background: var\(--vscode-progressBar-background\);/, 'ready progress must use stable geometry');
  assert.doesNotMatch(html, /#ready-progress \.bar \{[^}]*animation:/, 'ready progress must not drive a continuous resize/transform loop');
  assert.doesNotMatch(html, /#ready-progress\.done \{[^}]*height:\s*0/, 'ready completion must not resize the webview');

  assert.match(webview, /function setA11yStatus/, 'status updates must mirror to an aria-live region');
  assert.match(webview, /function activateOnEnterOrSpace/, 'clickable non-button rows must support Enter and Space');
  assert.match(webview, /workingEl\.setAttribute\('role', 'status'\)/, 'working area must be a live status surface');
  assert.match(webview, /todosWidgetEl\.setAttribute\('role', 'region'\)/, 'todo surface must name its region');
  assert.match(webview, /fileChangesWidgetEl\.setAttribute\('role', 'region'\)/, 'file changes surface must name its region');
  assert.match(webview, /role="list"/, 'todo rows must not rely on color-only state classes');
  assert.match(webview, /role="listitem"/, 'todo items must expose list item semantics');
  assert.match(webview, /aria-label="' \+ tooltip \+ '"/, 'todo item state must be available as text');
  assert.match(webview, /aria-expanded/, 'collapsible controls must expose expanded state');
  assert.match(webview, /role="button"/, 'clickable file rows must expose button semantics');
  assert.match(webview, /tabindex="0"/, 'clickable file rows must be keyboard-focusable');
  assert.match(webview, /activateOnEnterOrSpace\(row, function\(\)/, 'file rows must open from keyboard activation');
  assert.match(webview, /renderWorkflowCard\(card, msg\)[\s\S]*card\.setAttribute\('role', 'status'\)/, 'workflow cards must expose status text beyond color');
});
