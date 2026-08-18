import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(tmpdir(), `devseek-pending-edit-feedback-${process.pid}.cjs`);

execSync(
  `npx esbuild src/pending-edit-coordinator.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

class FakeUri {
  constructor(fsPath, scheme = 'file', uriPath = fsPath) {
    this.fsPath = fsPath;
    this.scheme = scheme;
    this.path = uriPath;
  }

  static file(filePath) {
    return new FakeUri(filePath);
  }

  static joinPath(base, ...segments) {
    return FakeUri.file(path.join(base.fsPath, ...segments));
  }

  static from(value) {
    return new FakeUri(value.path, value.scheme, value.path);
  }

  toString() {
    return `${this.scheme}:${this.path}`;
  }
}

class FakeEventEmitter {
  event() {}
  fire() {}
  dispose() {}
}

class FakePosition {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

const errorMessages = [];
const fakeVscode = {
  Uri: FakeUri,
  EventEmitter: FakeEventEmitter,
  Position: FakePosition,
  Selection: class { constructor(anchor, active) { this.anchor = anchor; this.active = active; } },
  Range: class { constructor(start, end) { this.start = start; this.end = end; } },
  TextEditorRevealType: { InCenter: 0 },
  ViewColumn: { Active: 1 },
  TabInputTextDiff: class {},
  workspace: {
    workspaceFolders: [],
    getConfiguration() {
      return { get(_key, fallback) { return fallback; } };
    },
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find(folder => uri.fsPath.startsWith(folder.uri.fsPath));
    },
    async openTextDocument(uri) {
      return { uri };
    },
    fs: {
      async stat() { return {}; },
    },
  },
  window: {
    activeTextEditor: undefined,
    tabGroups: { all: [], async close() {} },
    showErrorMessage(message) {
      errorMessages.push(message);
      return Promise.resolve(undefined);
    },
    showWarningMessage() { return Promise.resolve(undefined); },
    async showTextDocument() {
      return { selection: undefined, revealRange() {} };
    },
  },
  commands: {
    executeCommand() { return Promise.resolve(undefined); },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { PendingEditCoordinator } = createRequire(import.meta.url)(bundlePath);

function commitToken(workspaceRoot, filePath, oldContent, newContent) {
  const baseline = (content, existed) => ({
    absPath: filePath,
    workspaceRoot,
    snapshot: { absPath: filePath, existed, content },
    route: {
      canonicalPath: filePath,
      existingAncestorCanonicalPath: filePath,
      existingAncestorFingerprint: `file:${filePath}`,
      existingAncestorPath: filePath,
      missingSegments: [],
    },
    parentRoute: {
      canonicalPath: workspaceRoot,
      existingAncestorCanonicalPath: workspaceRoot,
      existingAncestorFingerprint: `dir:${workspaceRoot}`,
      existingAncestorPath: workspaceRoot,
      missingSegments: [],
    },
  });
  return {
    absPath: filePath,
    workspaceRoot,
    before: baseline(oldContent, oldContent.length > 0),
    after: baseline(newContent, true),
  };
}

function createHarness(t) {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-pending-edit-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const filePath = path.join(workspaceRoot, 'sample.txt');
  writeFileSync(filePath, 'NEW\n');
  fakeVscode.workspace.workspaceFolders = [{ uri: FakeUri.file(workspaceRoot), name: 'test', index: 0 }];
  errorMessages.length = 0;
  const messages = [];
  const webview = { postMessage(message) { messages.push(message); return Promise.resolve(true); } };
  const coordinator = new PendingEditCoordinator({
    getContextFiles: () => [filePath],
    getActiveWebview: () => webview,
  });
  return { workspaceRoot, filePath, messages, webview, coordinator };
}

test('pending edit Keep All settles from the source commit token and clears the queue', async t => {
  const harness = createHarness(t);
  await harness.coordinator.registerChange(harness.webview, {
    path: harness.filePath,
    existed: true,
    oldContent: 'OLD\n',
    newContent: 'NEW\n',
    commitToken: commitToken(harness.workspaceRoot, harness.filePath, 'OLD\n', 'NEW\n'),
  });

  await harness.coordinator.keepAllWithNotice(harness.webview);

  assert.equal(harness.coordinator.size, 0);
  assert.ok(harness.messages.some(message => message.type === 'pendingActionState' && message.status === 'started'));
  assert.ok(harness.messages.some(message => message.type === 'pendingActionState' && message.status === 'completed'));
  assert.ok(harness.messages.some(message => message.type === 'pendingActionNotice' && message.scope === 'all'));
  assert.equal(errorMessages.length, 0);
});

test('pending edit Keep All reports a visible failure and preserves the queue when provenance is missing', async t => {
  const harness = createHarness(t);
  await harness.coordinator.registerChange(harness.webview, {
    path: harness.filePath,
    existed: true,
    oldContent: 'OLD\n',
    newContent: 'NEW\n',
    commitToken: undefined,
  });

  await harness.coordinator.keepAllWithNotice(harness.webview);

  assert.equal(harness.coordinator.size, 1);
  const failed = harness.messages.find(message => message.type === 'pendingActionState' && message.status === 'failed');
  assert.match(failed?.detail || '', /source commit token/i);
  assert.ok(harness.messages.some(message => message.type === 'pendingEdits' && message.total === 1));
  assert.match(errorMessages.at(-1) || '', /source commit token/i);
});
