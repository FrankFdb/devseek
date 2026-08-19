import * as vscode from 'vscode';
import * as fs from 'fs';
import * as nodePath from 'path';

function getNonce(): string {
  return require('crypto').randomBytes(16).toString('hex');
}

type WebviewRuntimeManifest = {
    scripts?: string[];
};

function readMediaFile(extensionUri: vscode.Uri, fileName: string): string {
    return fs.readFileSync(nodePath.join(extensionUri.fsPath, 'media', fileName), 'utf8');
}

function readWebviewRuntimeJs(extensionUri: vscode.Uri): string {
    const manifest = JSON.parse(readMediaFile(extensionUri, 'webview-runtime.json')) as WebviewRuntimeManifest;
    const scripts = Array.isArray(manifest.scripts) && manifest.scripts.length > 0
        ? manifest.scripts
        : ['webview.js'];
    return scripts.map((fileName) => readMediaFile(extensionUri, fileName)).join('\n');
}

export function getChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const markedJs = readMediaFile(extensionUri, 'marked.umd.js');
    const webviewRuntimeJs = readWebviewRuntimeJs(extensionUri);
    const mermaidUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'mermaid.min.js'),
    );
    const codiconUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'codicon.css'),
    );
    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           script-src 'nonce-${nonce}';
           style-src 'unsafe-inline' ${webview.cspSource};
           font-src ${webview.cspSource};
           img-src ${webview.cspSource} data: https:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DevSeek</title>
<link rel="stylesheet" href="${codiconUri}">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html { height: 100%; overflow: hidden; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
#messages {
  background: var(--vscode-sideBar-background);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
button:focus-visible,
[role="button"]:focus-visible,
textarea:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}
.turn.enter { animation: turnIn .18s ease-out; }
@keyframes turnIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
#toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}
#ready-progress {
  height: 2px;
  width: 100%;
  background: transparent;
  overflow: hidden;
  flex-shrink: 0;
}
#ready-progress .bar {
  height: 100%;
  width: 100%;
  background: var(--vscode-progressBar-background);
  opacity: .78;
}
#ready-progress.done { opacity: 0; visibility: hidden; }
#toolbar .title { flex: 1; font-size: 11px; font-weight: 600; opacity: .65; text-transform: uppercase; letter-spacing: .05em; }
#toolbar button {
  font-size: 11px; padding: 2px 8px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none; border-radius: 3px; cursor: pointer;
}
#toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
#toolbar button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
#toolbar #sessions-btn { padding: 2px 8px; display:inline-flex; align-items:center; gap:5px; }
/* ── Sessions Panel (history drawer, scoped below toolbar) ── */
#content-area {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#sessions-panel {
  display: none; flex-direction: column;
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--vscode-sideBar-background);
  z-index: 100;
}
#sessions-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}
#sessions-panel-header span {
  font-size: 11px; font-weight: 600; opacity: .65; text-transform: uppercase; letter-spacing: .05em;
}
#sessions-panel-header button {
  background: none; border: none; cursor: pointer; padding: 2px 6px;
  color: var(--vscode-foreground); font-size: 14px; opacity: .5; border-radius: 3px;
}
#sessions-panel-header button:hover { background: var(--vscode-button-secondaryHoverBackground); opacity: 1; }
#sessions-list { flex: 1 1 0; overflow-y: auto; padding: 4px 0; }
.session-item {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 10px;
  cursor: pointer; border-radius: 4px; margin: 1px 4px;
  border: 1px solid transparent;
}
.session-item:hover { background: var(--vscode-list-hoverBackground); }
.session-item.active {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
  border-color: var(--vscode-focusBorder, rgba(99,179,255,.4));
}
.session-item-body { flex: 1; min-width: 0; }
.session-title { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-date { font-size: 10px; opacity: .5; margin-top: 1px; }
.session-delete-btn {
  flex-shrink: 0; border: none; background: none; cursor: pointer;
  color: var(--vscode-foreground); opacity: 0; padding: 2px 5px;
  border-radius: 3px; font-size: 13px; line-height: 1;
}
.session-item:hover .session-delete-btn { opacity: .4; }
.session-delete-btn:hover { opacity: 1 !important; background: var(--vscode-inputValidation-errorBackground); }
.sessions-empty { padding: 20px 12px; text-align: center; font-size: 12px; opacity: .45; }
#sessions-panel-footer {
  flex-shrink: 0; padding: 6px 8px; border-top: 1px solid var(--vscode-panel-border);
}
#sessions-panel-footer button {
  width: 100%; font-size: 11px; padding: 4px 8px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none; border-radius: 3px; cursor: pointer;
}
#sessions-panel-footer button:hover { background: var(--vscode-button-secondaryHoverBackground); }
/* restored session banner */
.session-restore-banner {
  display: flex; align-items: center; flex-wrap: wrap; gap: 5px;
  font-size: 11px; padding: 5px 8px;
  background: rgba(127,127,127,.08);
  border-radius: 6px; margin: 0 0 4px;
  border-left: 2px solid var(--vscode-charts-blue, #4fc1ff);
}
.srb-label { font-weight: 600; opacity: .7; }
.srb-date { opacity: .45; font-size: 10px; }
.srb-hint { margin-left: auto; opacity: .4; font-size: 10px; font-style: italic; }
.srb-summary-wrap { margin: 2px 0 4px; }
.srb-summary-toggle {
  background: none; border: none; cursor: pointer; font-size: 11px;
  color: var(--vscode-foreground); opacity: .5; padding: 2px 0;
}
.srb-summary-toggle:hover { opacity: .85; }
.srb-summary-body {
  margin-top: 4px; padding: 6px 10px;
  background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.06));
  border-radius: 4px; font-size: 11.5px; line-height: 1.55;
}
.srb-summary-body h2 { font-size: 12px; opacity: .8; margin: 6px 0 2px; }
.srb-summary-body ul { margin: 2px 0 4px; padding-left: 16px; }
.srb-summary-body li { margin: 1px 0; }
.srb-files-row { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 4px; padding: 0 2px; }
/* Session list item enhancements */
.session-title-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.session-title { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.session-badge {
  flex-shrink: 0; font-size: 9px; background: rgba(127,127,127,.15);
  border-radius: 3px; padding: 1px 4px; opacity: .7; white-space: nowrap;
}
.session-badge.file-badge { background: rgba(78,201,176,.12); color: var(--vscode-charts-green, #4ec9b0); opacity: 1; }
.session-digest {
  font-size: 10px; opacity: .5; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.3;
}
/* shared chip / badge */
.soc-badge {
  font-size: 9px; background: rgba(127,127,127,.15);
  border-radius: 3px; padding: 1px 5px; opacity: .7;
}
.soc-badge.file-badge { background: rgba(78,201,176,.12); color: var(--vscode-charts-green, #4ec9b0); opacity: 1; }
.soc-file-chip {
  display: inline-block; font-size: 10px; font-family: var(--vscode-editor-font-family, monospace);
  background: rgba(127,127,127,.12); border-radius: 3px;
  padding: 1px 5px; margin: 1px 0;
}
.soc-history-wrap { margin-top: 4px; border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.15)); padding-top: 4px; }
#messages { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 10px 8px; display: flex; flex-direction: column; gap: 12px; }
.turn { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.turn.user-turn  { align-items: flex-end; }
.turn.assistant-turn { align-items: flex-start; width: 100%; }
.user-bubble {
  max-width: 90%;
  width: fit-content;
  background: var(--vscode-chat-requestBubbleBackground, var(--vscode-chat-requestBackground, var(--vscode-input-background)));
  color: var(--vscode-foreground);
  border-radius: var(--vscode-cornerRadius-xLarge, 12px);
  padding: 8px 12px; font-size: .92em; line-height: 1.5;
  word-break: break-word;
}
.user-bubble-wrap { display:flex; flex-direction:column; align-items:flex-end; gap:4px; max-width: 90%; }
.user-msg-actions { display:flex; gap:6px; opacity:.78; }
.user-msg-actions button {
  border:none; border-radius:4px; padding:1px 7px; cursor:pointer;
  font-size:10px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
}
.user-msg-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); opacity:1; }
.user-edit-wrap {
  width: 100%;
  background: rgba(127,127,127,.12);
  border: 1px solid rgba(127,127,127,.32);
  border-radius: 8px;
  padding: 6px;
}
.user-edit-wrap textarea {
  width: 100%;
  min-height: 80px;
  resize: vertical;
  border: 1px solid var(--vscode-input-border);
  border-radius: 6px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 6px 8px;
  font: inherit;
}
.user-edit-actions { display:flex; justify-content:flex-end; gap:6px; margin-top:6px; }
.user-edit-actions button {
  border:none; border-radius:4px; padding:3px 10px; cursor:pointer; font-size:11px;
  background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
}
.user-edit-actions button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.user-bubble pre { background: rgba(127,127,127,.14); border-radius: 4px; padding: 6px 8px; margin: 4px 0; overflow-x: auto; font-size: .88em; }
.user-bubble code { font-family: var(--vscode-editor-font-family, monospace); }
.user-bubble p { margin: 0 0 4px; }
.user-bubble p:last-child { margin-bottom: 0; }
.user-bubble-images { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; max-width:100%; }
.user-bubble-img { max-width:min(180px, 100%); max-height:120px; border-radius:4px; border:1px solid var(--vscode-widget-border,#ccc); object-fit:contain; cursor:zoom-in; background:var(--vscode-editor-background); }
.user-bubble-img:hover { opacity:.85; }
.assistant-bubble {
  max-width: 100%;
  width: 100%;
  font-size: .92em;
  line-height: 1.68;
  word-break: break-word;
  padding: 2px 0;
}
.assistant-bubble p { margin: 0 0 6px; }
.assistant-bubble ul,.assistant-bubble ol { padding-left: 1.3em; margin: 0 0 6px; }
.assistant-bubble h1,.assistant-bubble h2,.assistant-bubble h3 { margin: 8px 0 4px; font-size: 1em; font-weight: 600; }
.assistant-bubble h1,.assistant-bubble h2,.assistant-bubble h3,.assistant-bubble h4 {
  border-bottom: 1px solid rgba(127,127,127,.23);
  padding-bottom: 4px;
}
.assistant-bubble blockquote {
  margin: 8px 0;
  padding: 6px 10px;
  border-left: 3px solid rgba(110, 168, 255, .65);
  background: rgba(127,127,127,.08);
  border-radius: 0 8px 8px 0;
  opacity: .95;
}
.assistant-bubble hr {
  border: none;
  border-top: 1px dashed rgba(127,127,127,.35);
  margin: 10px 0;
}
.assistant-bubble pre {
  position: relative;
  background: linear-gradient(180deg, rgba(127,127,127,0.12), rgba(127,127,127,0.04));
  border: 1px solid rgba(127,127,127,0.35);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 6px 18px rgba(0,0,0,0.14);
  padding: 10px 12px; padding-top: 34px;
  margin: 8px 0; overflow-x: auto; font-size: .9em;
  line-height: 1.6;
}
.assistant-bubble code { font-family: var(--vscode-editor-font-family, monospace); }
.assistant-bubble :not(pre) > code {
  background: var(--vscode-textPreformat-background, rgba(127,127,127,.16));
  border: 1px solid var(--vscode-textPreformat-border, rgba(127,127,127,.2));
  color: var(--vscode-textPreformat-foreground);
  padding: 1px 3px;
  border-radius: 4px;
  font-size: .9em;
}
.code-toolbar {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--vscode-textCodeBlock-background, rgba(40,44,52,.95));
  border-bottom: 1px solid rgba(127,127,127,.18);
  border-radius: 10px 10px 0 0;
}
.code-lang {
  font-size: 10px;
  letter-spacing: .04em;
  text-transform: uppercase;
  font-weight: 600;
  opacity: .52;
  color: var(--vscode-descriptionForeground);
}
.code-actions { display: inline-flex; gap: 4px; }
.code-toolbar button { font-size: 10px; padding: 1px 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; cursor: pointer; }
.code-toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.insert-btn { background: var(--vscode-button-background) !important; color: var(--vscode-button-foreground) !important; }
.assistant-bubble code .tok-keyword { color: #e28bff; font-weight: 600; }
.assistant-bubble code .tok-type { color: #7cc9ff; }
.assistant-bubble code .tok-string { color: #9ad97c; }
.assistant-bubble code .tok-number { color: #f7c66f; }
.assistant-bubble code .tok-comment { color: #7f8b99; font-style: italic; }
.assistant-bubble code .tok-preproc { color: #f4a261; }
.assistant-bubble code .tok-fn { color: #65d6c2; }
.cursor::after { content: '\u25ae'; animation: blink .7s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }
.thinking-dots { display:inline-flex; gap:3px; align-items:center; opacity:.55; padding:2px 0; }
.thinking-dots span { width:5px; height:5px; border-radius:50%; background:currentColor; display:inline-block; animation:tdot 1.2s ease-in-out infinite; }
.thinking-dots span:nth-child(2) { animation-delay:.2s; }
.thinking-dots span:nth-child(3) { animation-delay:.4s; }
@keyframes tdot { 0%,80%,100%{ opacity:.2; transform:scale(.7); } 40%{ opacity:1; transform:scale(1); } }
.error-msg { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 6px; padding: 6px 10px; font-size: .85em; white-space: pre-wrap; }
.generated-files-panel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(127,127,127,.3);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(127,127,127,.12), rgba(127,127,127,.05));
  font-size: .83em;
}
.generated-files-panel .gfp-label {
  opacity: .88;
  margin-right: 0;
}
.generated-files-panel .gfp-btn {
  border: none;
  border-radius: 4px;
  padding: 2px 9px;
  cursor: pointer;
  font-size: .95em;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.generated-files-panel .gfp-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.generated-files-panel .gfp-btn.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.generated-files-panel .gfp-btn.path-ref {
  background: linear-gradient(180deg, rgba(90, 170, 255, .30), rgba(60, 140, 240, .22));
  color: var(--vscode-button-foreground);
  border: 1px solid rgba(90, 170, 255, .55);
  font-weight: 600;
}
.generated-files-panel .gfp-btn.path-ref:hover {
  background: linear-gradient(180deg, rgba(90, 170, 255, .42), rgba(60, 140, 240, .32));
}
.generated-files-panel .gfp-map {
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.generated-files-panel .gfp-map-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid rgba(127,127,127,.22);
  border-radius: 7px;
  background: rgba(127,127,127,.06);
}
.generated-files-panel .gfp-item-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.generated-files-panel .gfp-main-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.assistant-generated-summary {
  padding: 4px 8px;
  border: 1px solid rgba(127,127,127,.18);
  border-radius: 6px;
  background: rgba(127,127,127,.05);
  font-size: .82em;
  opacity: .65;
}
.workflow-card {
  max-width: 100%;
  padding: 9px 11px;
  border-radius: 9px;
  font-size: .84em;
  line-height: 1.58;
  white-space: pre-wrap;
  border: 1px solid rgba(127,127,127,.28);
  background: linear-gradient(180deg, rgba(127,127,127,.12), rgba(127,127,127,.05));
}
.workflow-card.state-failed {
  border-color: rgba(255, 120, 120, .45);
  background: linear-gradient(180deg, rgba(255,120,120,.11), rgba(127,127,127,.05));
}
.workflow-card.state-passed {
  border-color: rgba(120, 220, 150, .42);
  background: linear-gradient(180deg, rgba(120,220,150,.11), rgba(127,127,127,.05));
}
.workflow-card .wf-head {
  font-weight: 700;
  margin-bottom: 5px;
}
#input-area { position: relative; display: flex; flex-direction: column; border-top: 1px solid var(--vscode-panel-border); padding: 6px; flex-shrink: 0; }
#input-row { display: flex; gap: 4px; }
#file-badges { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0 2px; min-height: 0; }
#file-badges:empty { display: none; }
.file-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px 2px 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; font-size: .78em; max-width: 220px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.file-badge .badge-remove { cursor: pointer; opacity: .7; margin-left: 2px; font-size: .9em; flex-shrink: 0; }
.file-badge .badge-remove:hover { opacity: 1; }
#context-files-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 0 1px; align-items: center; min-height: 0; }
#context-files-row:empty { display: none; }
.ctx-label { font-size: .72em; opacity: .45; margin-right: 2px; flex-shrink: 0; white-space: nowrap; }
.ctx-file-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px 1px 7px; background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-descriptionForeground); border-radius: 8px; font-size: .75em; opacity: .75; }
.ctx-file-badge .ctx-remove { cursor: pointer; opacity: .55; margin-left: 1px; font-size: .9em; flex-shrink: 0; }
.ctx-file-badge .ctx-remove:hover { opacity: 1; }
#input { flex: 1; resize: none; font-family: inherit; font-size: inherit; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 6px 8px; min-height: 38px; max-height: 160px; overflow-y: auto; line-height: 1.4; }
#input:focus { outline: 1px solid var(--vscode-focusBorder); }
#send-btn { padding: 0 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; cursor: pointer; font-size: 16px; flex-shrink: 0; }
#send-btn:hover { background: var(--vscode-button-hoverBackground); }
#input-hint { font-size: 10px; opacity: .45; margin-top: 3px; text-align: right; }
#jump-latest {
  position: absolute;
  right: 14px;
  bottom: 104px;
  z-index: 5;
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
  display: none;
}
#jump-latest.show { display: inline-block; }
#suggest-popup { display: none; position: absolute; bottom: 100%; left: 0; right: 0; background: var(--vscode-editorSuggestWidget-background, var(--vscode-input-background)); border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-panel-border)); border-radius: 6px; max-height: 180px; overflow-y: auto; z-index: 999; margin-bottom: 2px; }
#suggest-popup .item { padding: 5px 10px; cursor: pointer; display: flex; gap: 8px; align-items: center; font-size: .88em; }
#suggest-popup .item:hover, #suggest-popup .item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
#suggest-popup .item .lbl { font-weight: 600; min-width: 90px; }
#suggest-popup .item .desc { opacity: .65; font-size: .9em; }
/* ---- 状态栏 ---- */
#status-bar { display: flex; align-items: center; gap: 5px; padding: 3px 8px 4px; border-top: 1px solid var(--vscode-panel-border); font-size: 10px; flex-shrink: 0; background: var(--vscode-sideBar-background); min-width: 0; overflow: hidden; }
.s-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.s-online { background: #4caf50; }
.s-offline { background: #f44336; }
.s-pending { background: #ff9800; animation: blink .9s step-end infinite; }
#status-text { opacity: .7; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#login-btn { font-size: 10px; padding: 1px 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; }
#login-btn:hover { background: var(--vscode-button-hoverBackground); }
.s-spacer { flex: 1; }
#mode-switcher { display: flex; gap: 2px; flex-shrink: 0; }
.mode-btn { font-size: 10px; padding: 1px 9px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; border-radius: 3px; cursor: pointer; opacity: .65; }
.mode-btn:hover { opacity: 1; }
.mode-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; border-color: transparent; }
#autopilot-btn { font-size: 10px; padding: 1px 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; border-radius: 3px; cursor: pointer; opacity: .55; }
#autopilot-btn:hover { opacity: 1; }
#autopilot-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; border-color: rgba(90,170,255,.5); }
#agent-toggle-btn { font-size: 10px; padding: 1px 9px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; border-radius: 3px; cursor: pointer; opacity: .65; }
#agent-toggle-btn:hover { opacity: 1; }
#agent-toggle-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; border-color: rgba(90,170,255,.5); }
#status-bar button { white-space: nowrap; }
@media (max-width: 360px) {
  .mode-btn, #autopilot-btn, #agent-toggle-btn, #switch-provider-btn, #login-btn { padding-left: 5px; padding-right: 5px; }
  #agent-toggle-btn, #autopilot-btn { max-width: 58px; overflow: hidden; text-overflow: ellipsis; }
}
.mermaid-block { margin: 8px 0; border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; width: 100%; box-sizing: border-box; }
.mermaid-tabs { display: flex; background: var(--vscode-textCodeBlock-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 0 4px; }
.mermaid-tab { padding: 5px 14px; font-size: .82em; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--vscode-foreground); opacity: .55; }
.mermaid-tab.active { opacity: 1; border-bottom-color: var(--vscode-button-background); font-weight: 600; }
.mermaid-tab:hover { opacity: .85; }
.mermaid-render-panel { overflow: hidden; position: relative; cursor: grab; width: 100%; box-sizing: border-box; min-height: 60px; }
.mermaid-render-panel svg { display:block; }
.mermaid-zoom-bar { display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: var(--vscode-textCodeBlock-background); border-top: 1px solid var(--vscode-panel-border); }
.mermaid-zoom-btn { padding: 1px 8px; font-size: 13px; line-height: 1.4; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; cursor: pointer; font-family: monospace; }
.mermaid-zoom-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.mermaid-zoom-label { font-size: .78em; min-width: 38px; text-align: center; color: var(--vscode-descriptionForeground); }
.mermaid-render-error { color: var(--vscode-errorForeground); font-size: .82em; padding: 8px; }
.mermaid-code-panel { position: relative; }
.mermaid-code-panel pre { margin: 0; background: var(--vscode-textCodeBlock-background); padding: 10px 12px; padding-top: 30px; overflow-x: auto; font-size: .87em; font-family: var(--vscode-editor-font-family, monospace); white-space: pre; }
.mermaid-copy-btn { position: absolute; top: 4px; right: 6px; font-size: 10px; padding: 2px 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; cursor: pointer; }
.mermaid-copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
/* ---- 表格样式 ---- */
.assistant-bubble table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: .9em; }
.assistant-bubble th, .assistant-bubble td { border: 1px solid var(--vscode-panel-border); padding: 5px 12px; text-align: left; vertical-align: top; }
.assistant-bubble th { background: var(--vscode-textCodeBlock-background); font-weight: 600; }
.assistant-bubble tr:nth-child(even) td { background: rgba(128,128,128,.04); }
</style>
</head>
<body style="position:relative;">
<div id="a11y-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">连接中...</div>
<div id="toolbar" role="toolbar" aria-label="DevSeek 对话工具栏">
  <button id="sessions-btn" title="历史对话" aria-label="打开历史对话"><i class="codicon codicon-history"></i> 历史对话</button>
  <button id="new-session-btn" title="开启新 AI 对话" aria-label="开启新 AI 对话">+ 新对话</button>
  <button id="clear-btn" title="清空界面消息" aria-label="清空界面消息">清空</button>
</div>
<div id="content-area">
<div id="sessions-panel" role="dialog" aria-label="历史对话" aria-modal="false">
  <div id="sessions-panel-header">
    <span>历史对话</span>
    <button id="sessions-close-btn" title="关闭" aria-label="关闭历史对话" style="margin-left:auto">×</button>
  </div>
  <div id="sessions-list" role="list"></div>
  <div id="sessions-panel-footer">
    <button id="sessions-new-btn" aria-label="新建对话">+ 新建对话</button>
  </div>
</div>
<div id="ready-progress" role="progressbar" aria-label="DevSeek 正在连接"><div class="bar"></div></div>
<div id="messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="DevSeek 对话消息"></div>
<button id="jump-latest" title="跳到最新消息" aria-label="跳到最新消息">⬇ 新内容</button>
<div id="input-area">
  <div id="suggest-popup" role="listbox" aria-label="输入建议"></div>
  <div id="file-badges" role="status" aria-live="polite" aria-label="已附加文件"></div>
  <div id="context-files-row" role="status" aria-live="polite" aria-label="上下文文件"></div>
  <div id="agent-queue-indicator" role="status" aria-live="polite" aria-label="排队消息"></div>
  <div id="input-row">
    <textarea id="input" rows="1" placeholder="问 DevSeek...  / 命令  @文件  #problems" aria-label="输入给 DevSeek 的消息" aria-describedby="input-hint"></textarea>
    <button id="send-btn" title="发送 (Enter)" aria-label="发送消息">&#x27a4;</button>
  </div>
  <div id="input-hint">Shift+Enter 换行 &middot; ⏹ 停止生成 &middot; / 命令 &middot; @文件 &middot; #problems</div>
</div>
</div>
<div id="status-bar" role="status" aria-live="polite" aria-label="DevSeek 连接状态">
  <span class="s-dot s-pending" id="s-dot" aria-hidden="true"></span>
  <span id="status-text">连接中...</span>
  <button id="login-btn" style="display:none" aria-label="登录 DeepSeek">🔑 登录</button>
  <button id="switch-provider-btn" title="切换 LLM Provider / 设置" aria-label="切换 LLM Provider 或打开设置">&#9881;</button>
  <span class="s-spacer"></span>
  <div id="mode-switcher" role="group" aria-label="回复模式">
    <button class="mode-btn active" data-mode="fast" aria-pressed="true">⚡ 快速</button>
    <button class="mode-btn" data-mode="r1" aria-pressed="false">🧠 专家 R1</button>
  </div>
  <button id="agent-toggle-btn" title="Agent 模式：开启时自动解析意图和执行多轮编辑，关闭时强制走普通对话" aria-pressed="true">🤖 Agent</button>
  <button id="autopilot-btn" title="自动驾驶：开启后 Agent 完成时自动接受所有文件改动" aria-pressed="false">🤖 自动</button>
</div>
<script nonce="${nonce}" src="${mermaidUri}"></script>
<script nonce="${nonce}">/*MARKED_PLACEHOLDER*/</script>
<script nonce="${nonce}">window.__wsFolderName = ${JSON.stringify(vscode.workspace.workspaceFolders?.[0]?.name ?? '')};</script>
<script nonce="${nonce}">/*WEBVIEW_PLACEHOLDER*/</script>
</body>
</html>`;
    return html
        .replace('/*MARKED_PLACEHOLDER*/', () => markedJs)
        .replace('/*WEBVIEW_PLACEHOLDER*/', () => webviewRuntimeJs);
}
