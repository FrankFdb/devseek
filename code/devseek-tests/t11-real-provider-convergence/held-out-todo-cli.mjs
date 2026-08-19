#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const workspace = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !existsSync(path.join(workspace, 'src/cli.js'))) {
  console.error('Usage: node held-out-todo-cli.mjs <generated-workspace>');
  process.exit(2);
}

const sandboxRoot = mkdtempSync(path.join(tmpdir(), 'devseek-held-out-todo-cli-'));
const sandbox = path.join(sandboxRoot, 'subject');
cpSync(workspace, sandbox, {
  recursive: true,
  filter(source) {
    const relative = path.relative(workspace, source);
    const rootName = relative.split(path.sep)[0];
    return !['.devseek', '.vscode', 'data'].includes(rootName);
  },
});
const cliPath = path.join(sandbox, 'src/cli.js');
const requireFromWorkspace = createRequire(path.join(sandbox, 'package.json'));
const TaskService = requireFromWorkspace('./src/task-service.js');
const JsonFileRepository = requireFromWorkspace('./src/json-file-repository.js');
const checks = [];

function check(name, operation) {
  try {
    operation();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: sandbox,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function discoverTaskData() {
  const candidates = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      if (name === 'node_modules') continue;
      const filePath = path.join(directory, name);
      if (statSync(filePath).isDirectory()) {
        visit(filePath);
        continue;
      }
      if (!name.endsWith('.json') || name === 'package.json') continue;
      try {
        const value = JSON.parse(readFileSync(filePath, 'utf8'));
        if (Array.isArray(value) && value.every(item => (
          item && typeof item === 'object' && 'description' in item && 'priority' in item
        ))) {
          candidates.push({ filePath, tasks: value });
        }
      } catch {
        // Non-task JSON is irrelevant to this held-out behavior check.
      }
    }
  };
  visit(sandbox);
  assert.equal(candidates.length, 1, `expected one persisted task collection, found ${candidates.length}`);
  return candidates[0];
}

let taskData;

try {
  check('package has no runtime dependencies', () => {
    const manifest = JSON.parse(readFileSync(path.join(workspace, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.dependencies || {}), []);
  });

  check('all priorities persist across CLI processes', () => {
    for (const [description, priority] of [
      ['urgent item', 'high'],
      ['ordinary item', 'normal'],
      ['later item', 'low'],
    ]) {
      const result = runCli('add', description, priority);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    taskData = discoverTaskData();
    assert.deepEqual(taskData.tasks.map(task => task.priority).sort(), ['high', 'low', 'normal']);
    assert.equal(existsSync(`${taskData.filePath}.tmp`), false);
  });

  check('status filters and done survive separate CLI processes', () => {
    const urgent = taskData.tasks.find(task => task.description === 'urgent item');
    assert.ok(urgent);
    const completed = runCli('done', String(urgent.id));
    assert.equal(completed.status, 0, completed.stderr || completed.stdout);
    const pending = runCli('list', 'pending');
    const done = runCli('list', 'done');
    assert.equal(pending.status, 0, pending.stderr || pending.stdout);
    assert.equal(done.status, 0, done.stderr || done.stdout);
    assert.doesNotMatch(pending.stdout, /urgent item/u);
    assert.match(done.stdout, /urgent item/u);
  });

  check('stats reflect persisted state', () => {
    const result = runCli('stats');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Total:\s*3/iu);
    assert.match(result.stdout, /Done:\s*1/iu);
    assert.match(result.stdout, /Pending:\s*2/iu);
  });

  check('invalid command, status, priority, and unknown task fail', () => {
    const knownId = taskData.tasks[0]?.id;
    const unknownId = typeof knownId === 'number' ? String(knownId + 999_999) : 'held-out-unknown-task-id';
    const failures = [
      runCli('unknown'),
      runCli('list', 'unexpected'),
      runCli('add', 'bad priority', 'urgent'),
      runCli('done', unknownId),
    ];
    for (const result of failures) {
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(`${result.stderr}\n${result.stdout}`, /error|invalid|unknown|not found/iu);
    }
  });

  check('blank descriptions fail', () => {
    const result = runCli('add', '   ', 'normal');
    assert.notEqual(result.status, 0, result.stdout);
  });

  check('numeric ids reject partial parsing when numeric ids are used', () => {
    const pending = taskData.tasks.find(task => task.description === 'ordinary item');
    assert.ok(pending);
    if (typeof pending.id !== 'number') return;
    const result = runCli('done', `${pending.id}abc`);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(`${result.stderr}\n${result.stdout}`, /valid task id|required|invalid/iu);
  });

  check('repository replaces through a same-directory temporary file', () => {
    const filePath = path.join(sandbox, 'repository-check', 'tasks.json');
    const repository = new JsonFileRepository(filePath);
    const service = new TaskService(repository);
    service.add('atomic item', 'high');
    assert.equal(existsSync(`${filePath}.tmp`), false);
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8'))[0].description, 'atomic item');
  });
} finally {
  rmSync(sandboxRoot, { recursive: true, force: true });
}

const failed = checks.filter(result => !result.ok);
console.log(JSON.stringify({
  workspace,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
}, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
