import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const bin = path.join(cliRoot, 'dist/index.js');
const require = createRequire(import.meta.url);
const {
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
} = require('../../shared/dist/index.js');

function withTempCwd(fn) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'devseek-cli-test-'));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function withTempCwdAsync(fn) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'devseek-cli-test-'));
  try {
    return await fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function readProductEvidenceRecords(cwd) {
  const evidenceRoot = path.join(cwd, '.devseek', 'run-evidence', 'v1');
  const [runDirectory] = readdirSync(evidenceRoot);
  return readdirSync(path.join(evidenceRoot, runDirectory, 'records'))
    .sort()
    .map(name => JSON.parse(readFileSync(path.join(evidenceRoot, runDirectory, 'records', name), 'utf8')));
}

function readCliErrorMessage(stderr) {
  const match = stderr.match(/DevSeek CLI error: ([^\r\n]+)/);
  assert.ok(match, `missing CLI error diagnostic in stderr: ${stderr}`);
  return match[1];
}

function parseJsonl(stdout) {
  return stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

test('CLI JSONL renderer owns stdout backpressure before process settlement', () => {
  const adapterSource = readFileSync(path.join(cliRoot, 'src/cli-surface-adapter.ts'), 'utf8');
  const indexSource = readFileSync(path.join(cliRoot, 'src/index.ts'), 'utf8');

  assert.match(adapterSource, /renderEvent\(event: AgentEvent\): Promise<void>/);
  assert.match(adapterSource, /writeQueue/);
  assert.match(adapterSource, /once\([^)]*['"]drain['"]/s);
  assert.match(indexSource, /await surface\.flush\(\)/);
});

test('R3-08B CLI JSONL emits machine-readable collaboration lifecycle schema', async () => {
  await withTempCwdAsync(async (cwd) => {
    const result = await runCli([bin, 'exec', '--jsonl', '--mock', 'r3-08b jsonl lifecycle smoke'], {
      cwd,
      timeout: 5000,
    });

    assert.equal(result.status, 0, result.stderr);
    const lines = parseJsonl(result.stdout);
    const lifecycle = lines.filter(line => line.schema === 'devseek.cli-jsonl-collaboration/v1');
    assert.deepEqual(lifecycle.map(line => line.type), ['cli.run.started', 'cli.run.completed']);
    assert.equal(lifecycle[0].surface, 'jsonl');
    assert.equal(lifecycle[0].status, 'running');
    assert.equal(lifecycle[1].status, 'completed');
    assert.equal(lifecycle[1].exitCode, 0);
    assert.match(lifecycle[0].runId, /^\d{8}-\d{6}/);
    assert.equal(lifecycle[0].commandId, lifecycle[1].commandId);
    assert.deepEqual(lifecycle[1].backpressure, {
      owner: 'CliSurfaceAdapter',
      queue: 'writeQueue',
      drainEvent: 'drain',
      renderEventAwaited: true,
      flushRequiredBeforeSettlement: true,
    });
    assert.deepEqual(lifecycle[1].cancel, {
      requested: false,
      signal: null,
      exitCode: null,
    });
  });
});

test('CLI JSONL mode emits parseable AgentEvent lines', () => {
  const stdout = withTempCwd((cwd) => {
    return execFileSync(process.execPath, [bin, 'exec', '--jsonl', '--mock', 'phase10 cli jsonl smoke'], {
      cwd,
      encoding: 'utf8',
    });
  });

  const events = parseJsonl(stdout).filter(event => event.schema !== 'devseek.cli-jsonl-collaboration/v1');
  assert.deepEqual(events.map(event => event.type), [
    'chat.started',
    'provider.selected',
    'chat.completed',
  ]);
  assert.equal(events.at(-1).response, 'mock: phase10 cli jsonl smoke');
});

test('CLI JSONL mode keeps stdout strict and settles evidence as jsonl surface', async () => {
  await withTempCwdAsync(async (cwd) => {
    const result = await runCli([bin, 'exec', '--jsonl', '--mock', 'jsonl surface settlement smoke'], {
      cwd,
      timeout: 5000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.trim(), '');
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.ok(lines.length >= 3);
    const events = lines.map((line, index) => {
      assert.doesNotMatch(line, /^DevSeek\b/, `stdout line ${index + 1} must be JSONL, not diagnostics`);
      return JSON.parse(line);
    });
    assert.equal(events.every(event => event.surface === 'jsonl' || !('surface' in event)), true);

    const records = readProductEvidenceRecords(cwd);
    const evidenceEvents = records.filter(record => record.record_kind === 'event').map(record => record.event);
    assert.equal(evidenceEvents.every(event => event.surface === 'jsonl'), true);
    assert.equal(evidenceEvents.find(event => event.type === 'run.opened')?.payload.owner_surface, 'jsonl');
    assert.equal(evidenceEvents.find(event => event.type === 'run.settled')?.payload.details.surface, 'jsonl');
    assert.equal(records.at(-1).record_kind, 'seal');
  });
});

test('CLI JSONL resume replays the last prompt without stdout diagnostics', async () => {
  await withTempCwdAsync(async (cwd) => {
    const first = await runCli([bin, 'exec', '--jsonl', '--mock', 'jsonl resume original prompt'], {
      cwd,
      timeout: 5000,
    });
    assert.equal(first.status, 0, first.stderr);

    const resumed = await runCli([bin, 'exec', '--jsonl', '--mock', '--resume'], {
      cwd,
      timeout: 5000,
    });

    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.stderr.trim(), '');
    const events = resumed.stdout.trim().split(/\r?\n/).map((line, index) => {
      assert.doesNotMatch(line, /^DevSeek\b/, `stdout line ${index + 1} must be JSONL, not diagnostics`);
      return JSON.parse(line);
    });
    assert.equal(events.find(event => event.type === 'chat.started')?.prompt, 'jsonl resume original prompt');
    assert.equal(events.find(event => event.type === 'chat.completed')?.response, 'mock: jsonl resume original prompt');
    assert.equal(events.every(event => event.surface === 'jsonl' || !('surface' in event)), true);
  });
});

test('CLI text mode prints provider response', () => {
  const stdout = withTempCwd((cwd) => {
    return execFileSync(process.execPath, [bin, 'exec', '--mock', 'phase10 cli text smoke'], {
      cwd,
      encoding: 'utf8',
    });
  });

  assert.match(stdout, /mock: phase10 cli text smoke/);
});

test('R3-08B CLI text mode exposes collaboration lifecycle status on stderr', async () => {
  await withTempCwdAsync(async (cwd) => {
    const result = await runCli([bin, 'exec', '--mock', 'r3-08b text lifecycle smoke'], {
      cwd,
      env: {
        ...process.env,
        DEVSEEK_CLI_COLLABORATION_STATUS: '1',
      },
      timeout: 5000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mock: r3-08b text lifecycle smoke/);
    assert.match(result.stderr, /DevSeek CLI: run started \(\d{8}-\d{6}/);
    assert.match(result.stderr, /DevSeek CLI: run completed \(exit=0\)/);
  });
});

test('CLI bridge text mode streams SSE, propagates one run identity, and seals product evidence', async () => {
  await withTestBridge(async ({ port, seenBodies, seenHeaders }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', 'phase10 delayed bridge smoke'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '20',
        },
        timeout: 5000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /delayed bridge response/);
      assert.equal(result.stdout.includes('RESET'), false);
      assert.match(result.stderr, /waiting for Bridge provider response/);
      assert.equal(seenBodies.length, 1);
      assert.equal(seenBodies[0].stream, true);
      assert.match(String(seenHeaders[0]['x-devseek-run-id']), /^\d{8}-\d{6}/);
      assert.equal(seenHeaders[0]['x-devseek-trace-workspace-root'], cwd);
      assert.equal(seenHeaders[0]['x-devseek-operation-id'], 'cli-provider-1');
      assert.match(String(seenHeaders[0]['x-devseek-evidence-authority']), /^devseek-ra1_/);

      const evidenceRoot = path.join(cwd, '.devseek', 'run-evidence', 'v1');
      const [runDirectory] = readdirSync(evidenceRoot);
      const records = readdirSync(path.join(evidenceRoot, runDirectory, 'records'))
        .sort()
        .map(name => JSON.parse(readFileSync(path.join(evidenceRoot, runDirectory, 'records', name), 'utf8')));
      const events = records
        .filter(record => record.record_kind === 'event')
        .map(record => record.event);
      assert.deepEqual(
        events.map(event => event.type),
        [
          'run.opened',
          'command.accepted',
          'provider.requested',
          'provider.requested',
          'provider.completed',
          'provider.completed',
          'agent.status',
          'agent.status',
          'agent.status',
          'run.settled',
        ],
      );
      assert.deepEqual(
        events
          .filter(event => event.payload.schema === 'devseek.coding-run-lifecycle-evidence/v1')
          .map(event => event.payload.status),
        ['accepted', 'running', 'completed'],
      );
      assert.equal(records.at(-1).record_kind, 'seal');
      assert.equal(records.every(record => record.record_kind !== 'event' || record.event.qualification_eligible === false), true);
    });
  });
});

test('CLI applies a natural model-selected target through the canonical plan revision boundary', async () => {
  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'Implement the requested behavior and run tests'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(path.join(cwd, 'src/unplanned.cpp'), 'utf8'), 'int main() { return 0; }\n');
      const events = readProductEvidenceRecords(cwd)
        .filter(record => record.record_kind === 'event')
        .map(record => record.event);
      assert.ok(events.some(event => (
        event.type === 'side_effect.committed'
        && event.payload.operation_id === 'cli-file-write-1'
      )));
    });
  }, () => ({
    content: '[TOOL:create_file {"filePath":"src/unplanned.cpp","content":"int main() { return 0; }\\n"}]',
  }));
});

test('CLI applies loose file tool JSON and emits coding evidence events', async () => {
  const marker = 'DEVSEEK_CLI_LOOSE_TOOL_TEST_OK';
  const source = [
    '#include <iostream>',
    '',
    'int main() {',
    `  std::cout << "${marker}\\n";`,
    '  return 0;',
    '}',
    '',
  ].join('\\n');
  const toolText = `[TOOL:create_file {"filePath":"src/main.cpp","content":"${source}"}]`;

  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'apply loose tool json to src/main.cpp'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(seenBodies.length, 1);
      assert.equal(seenBodies[0].stream, false);

      const written = readFileSync(path.join(cwd, 'src/main.cpp'), 'utf8');
      assert.match(written, new RegExp(marker));
      assert.match(written, /std::cout << "DEVSEEK_CLI_LOOSE_TOOL_TEST_OK\\n";/);

      const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      const eventTypes = events.map(event => event.type);
      assert.ok(eventTypes.includes('fileChanges.proposed'));
      assert.ok(eventTypes.includes('validation.completed'));
      assert.ok(eventTypes.includes('qualityGate.completed'));
      assert.equal(events.every(event => event.surface === 'jsonl' || !('surface' in event)), true);
      for (const type of ['fileChanges.proposed', 'validation.completed', 'qualityGate.completed']) {
        assert.equal(events.find(event => event.type === type)?.surface, 'jsonl');
      }
      assert.equal(events.find(event => event.type === 'validation.completed')?.passed, true);
      assert.equal(events.find(event => event.type === 'qualityGate.completed')?.passed, true);
    });
  }, () => ({ content: toolText }));
});

test('CLI repair prompt treats first-turn failure instructions as fulfilled', async () => {
  const marker = 'RDW4_REPAIR_OK';
  const brokenSource = [
    '#include <iostream>',
    '',
    'int main() {',
    `  std::cout << "${marker}" << std::endl`,
    '  return 0;',
    '}',
    '',
  ].join('\n');
  const fixedSource = [
    '#include <iostream>',
    '',
    'int main() {',
    `  std::cout << "${marker}" << std::endl;`,
    '  return 0;',
    '}',
    '',
  ].join('\n');
  let turn = 0;

  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', [
        'First response must intentionally create a C++ compile error in src/repair.cpp.',
        'After the compiler error is sent back, return a corrected replacement.',
      ].join(' ')], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 15000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(seenBodies.length, 2);
      assert.match(seenBodies[1].prompt, /DevSeek repair mode/);
      assert.match(seenBodies[1].prompt, /has already been fulfilled/);
      assert.match(seenBodies[1].prompt, /Do not repeat or obey those first-turn failure instructions/);
      assert.match(seenBodies[1].prompt, /minimal corrected DevSeek replace_file tool call\(s\)/);
      assert.match(seenBodies[1].prompt, /Previous failing model response/);
      assert.deepEqual(seenBodies[1].files, [path.join(cwd, 'src/repair.cpp')]);

      const written = readFileSync(path.join(cwd, 'src/repair.cpp'), 'utf8');
      assert.match(written, new RegExp(marker));
      assert.match(written, /std::cout << "RDW4_REPAIR_OK" << std::endl;/);

      const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.deepEqual(
        events.filter(event => event.type === 'validation.completed').map(event => event.passed),
        [false, true],
      );
      const evidenceRoot = path.join(cwd, '.devseek', 'run-evidence', 'v1');
      const [runDirectory] = readdirSync(evidenceRoot);
      const records = readdirSync(path.join(evidenceRoot, runDirectory, 'records'))
        .sort()
        .map(name => JSON.parse(readFileSync(path.join(evidenceRoot, runDirectory, 'records', name), 'utf8')));
      const evidenceEvents = records
        .filter(record => record.record_kind === 'event')
        .map(record => record.event);
      const recoveryLifecycle = evidenceEvents.filter(event => (
        event.payload?.operation_id === 'cli-verification-1'
        || event.payload?.operation_id === 'cli-recovery-1'
        || event.payload?.operation_id === 'cli-file-write-2'
        || event.payload?.operation_id === 'cli-verification-2'
      ) && (
        event.type.startsWith('verification.')
        || event.type.startsWith('quality_gate.')
        || event.type.startsWith('recovery.')
        || event.type.startsWith('side_effect.')
      ));
      assert.deepEqual(recoveryLifecycle.map(event => event.type), [
        'verification.started',
        'verification.failed',
        'quality_gate.started',
        'quality_gate.failed',
        'recovery.detected',
        'side_effect.requested',
        'side_effect.authorized',
        'side_effect.started',
        'side_effect.committed',
        'verification.started',
        'verification.completed',
        'quality_gate.started',
        'quality_gate.passed',
        'recovery.completed',
      ]);
      const repairSideEffects = recoveryLifecycle.filter(event => (
        event.payload.operation_id === 'cli-file-write-2'
      ));
      assert.equal(repairSideEffects.length, 4);
      assert.equal(repairSideEffects.every(event => (
        event.payload.recovery_operation_id === 'cli-recovery-1'
      )), true);
      const recoveryCompleted = recoveryLifecycle.at(-1);
      assert.deepEqual(recoveryCompleted.payload.resolves_operation_ids, ['cli-verification-1']);
      assert.equal(recoveryCompleted.payload.verification_operation_id, 'cli-verification-2');
      assert.ok(evidenceEvents.some(event => event.type === 'run.settled'));
      assert.equal(records.at(-1).record_kind, 'seal');
    });
  }, () => {
    turn += 1;
    if (turn === 1) {
      return {
        content: `[TOOL:create_file ${JSON.stringify({ filePath: 'src/repair.cpp', content: brokenSource })}]`,
      };
    }
    return {
      content: `[TOOL:replace_file ${JSON.stringify({ filePath: 'src/repair.cpp', content: fixedSource })}]`,
    };
  });
});

test('CLI records recovery.failed and seals failed evidence when the repair provider throws', async () => {
  const brokenSource = [
    '#include <iostream>',
    'int main() {',
    '  return missing_repair_symbol;',
    '}',
    '',
  ].join('\n');
  let turn = 0;

  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'create and validate src/provider-failure.cpp'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /repair provider unavailable|Bridge request failed|503/);
      const records = readProductEvidenceRecords(cwd);
      const events = records.filter(record => record.record_kind === 'event').map(record => record.event);
      assert.ok(events.some(event => event.type === 'recovery.detected'));
      const recoveryFailed = events.find(event => event.type === 'recovery.failed');
      assert.ok(recoveryFailed);
      assert.deepEqual(recoveryFailed.payload.reason, summarizeTraceText(readCliErrorMessage(result.stderr)));
      assert.equal(events.some(event => event.type === 'recovery.completed'), false);
      assert.equal(events.at(-1)?.type, 'run.settled');
      assert.equal(events.at(-1)?.payload.status, 'failed');
      assert.equal(records.at(-1)?.record_kind, 'seal');
    });
  }, () => {
    turn += 1;
    if (turn === 1) {
      return {
        content: `[TOOL:create_file ${JSON.stringify({ filePath: 'src/provider-failure.cpp', content: brokenSource })}]`,
      };
    }
    return { statusCode: 503, error: 'repair provider unavailable', content: '' };
  });
});

test('CLI records recovery.failed and preserves an unsafe repair apply error', async () => {
  const brokenSource = [
    '#include <iostream>',
    'int main() {',
    '  return missing_apply_symbol;',
    '}',
    '',
  ].join('\n');
  let turn = 0;

  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'create and validate src/apply-failure.cpp'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Refusing to write outside workspace/);
      const records = readProductEvidenceRecords(cwd);
      const events = records.filter(record => record.record_kind === 'event').map(record => record.event);
      const recoveryFailed = events.find(event => event.type === 'recovery.failed');
      assert.ok(recoveryFailed);
      assert.deepEqual(recoveryFailed.payload.reason, summarizeTraceText(readCliErrorMessage(result.stderr)));
      assert.ok(recoveryFailed.payload.unresolved_operation_ids.includes('cli-file-write-2'));
      const rejectedWrite = events.find(event => (
        event.type === 'side_effect.failed' && event.payload.operation_id === 'cli-file-write-2'
      ));
      assert.ok(rejectedWrite);
      assert.equal(rejectedWrite.payload.reason, 'workspace-path-outside-root:../escape.cpp');
      assert.equal(events.some(event => event.type === 'side_effect.indeterminate'), false);
      assert.equal(events.some(event => event.type === 'recovery.completed'), false);
      assert.equal(events.at(-1)?.type, 'run.settled');
      assert.equal(events.at(-1)?.payload.status, 'failed');
      assert.equal(records.at(-1)?.record_kind, 'seal');
    });
  }, () => {
    turn += 1;
    if (turn === 1) {
      return {
        content: `[TOOL:create_file ${JSON.stringify({ filePath: 'src/apply-failure.cpp', content: brokenSource })}]`,
      };
    }
    return {
      content: `[TOOL:replace_file ${JSON.stringify({ filePath: '../escape.cpp', content: 'int main() { return 0; }\n' })}]`,
    };
  });
});

test('I18-CLI-01 user journey: pre-existing project verifier cannot be weakened by generated source', async () => {
  const incompleteSource = [
    '#include <iostream>',
    '',
    'int main() {',
    '  std::cout << "TODO:alpha" << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  const completeSource = [
    '#include <iostream>',
    '',
    'int main() {',
    '  std::cout << "TODO:alpha" << std::endl;',
    '  std::cout << "TODO:beta" << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  let turn = 0;

  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      writeFileSync(path.join(cwd, 'devseek.verify.json'), JSON.stringify({
        commands: [{
          cmd: 'python3',
          args: [
            '-c',
            [
              'import os, subprocess',
              'output = os.path.join(os.environ["DEVSEEK_VERIFICATION_OUTPUT_DIR"], "todo")',
              'subprocess.run(["g++", "-std=c++17", "src/todo.cpp", "-o", output], check=True)',
              'print(subprocess.check_output([output], text=True), end="")',
            ].join('; '),
          ],
          expectStdoutIncludes: ['TODO:alpha', 'TODO:beta'],
        }],
      }, null, 2));
      const result = await runCli([bin, 'exec', '--jsonl', [
        'Create src/todo.cpp as a C++17 program.',
        'Preserve the first line exactly: TODO:alpha.',
        'Add a second output line exactly: TODO:beta.',
      ].join(' ')], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 15000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(seenBodies.length, 2);
      assert.match(seenBodies[1].prompt, /stdout missed "TODO:beta"/);
      assert.match(seenBodies[1].prompt, /TODO:beta/);

      const written = readFileSync(path.join(cwd, 'src/todo.cpp'), 'utf8');
      assert.match(written, /TODO:alpha/);
      assert.match(written, /TODO:beta/);

      const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.deepEqual(
        events.filter(event => event.type === 'validation.completed').map(event => event.passed),
        [false, true],
      );
    });
  }, () => {
    turn += 1;
    if (turn === 1) {
      return {
        content: `[TOOL:create_file ${JSON.stringify({ filePath: 'src/todo.cpp', content: incompleteSource })}]`,
      };
    }
    return {
      content: `[TOOL:replace_file ${JSON.stringify({ filePath: 'src/todo.cpp', content: completeSource })}]`,
    };
  });
});

test('CLI applies DeepSeek XML tool_call responses with loose C++ JSON content', async () => {
  const response = '<tool_call>{"name": "create_file", "arguments": {"filePath": "src/todo.cpp", "content": "#include <iostream>\\n\\nint main() {\\n  std::cout << "TODO:alpha\\n";\\n  return 0;\\n}\\n"}}</tool_call>';

  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'Create src/todo.cpp. The program must print exactly one line: TODO:alpha'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 0, result.stderr);
      const written = readFileSync(path.join(cwd, 'src/todo.cpp'), 'utf8');
      assert.match(written, /TODO:alpha\\n/);

      const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.ok(events.map(event => event.type).includes('fileChanges.proposed'));
      assert.equal(events.find(event => event.type === 'validation.completed')?.passed, true);
    });
  }, () => ({ content: response }));
});

test('CLI preserves loose XML Python escapes and verifies the repaired syntax', async () => {
  const response = '<tool_call>{"name": "create_file", "arguments": {"filePath": "src/greeter.py", "content": "import sys\\n\\ndef main():\\n    name = sys.stdin.readline().rstrip(\'\\n\')\\n    print(f"HELLO:{name}")\\n    print(**file**)\\n\\nif **name** == \\"**main**\\":\\n    main()\\n"}}</tool_call>';

  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'Create src/greeter.py'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 0, result.stderr);
      const written = readFileSync(path.join(cwd, 'src/greeter.py'), 'utf8');
      assert.match(written, /rstrip\('\\n'\)/);
      assert.doesNotMatch(written, /rstrip\('\n'\)/);
      assert.match(written, /if __name__ == "__main__":/);
      assert.match(written, /print\(__file__\)/);
      assert.doesNotMatch(written, /\*\*name\*\*/);
      assert.doesNotMatch(written, /\*\*file\*\*/);
      const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.equal(events.find(event => event.type === 'validation.completed')?.passed, true);
    });
  }, () => ({ content: response }));
});

test('CLI accepts compatible tests verifier schema with stdin stdout assertions', async () => {
  const response = [
    `[TOOL:create_file ${JSON.stringify({
      filePath: 'src/greeter.py',
      content: [
        'import sys',
        '',
        'name = sys.stdin.readline().strip()',
        'print(f"HELLO:{name}")',
        '',
      ].join('\n'),
    })}]`,
    `[TOOL:create_file ${JSON.stringify({
      filePath: 'devseek.verify.json',
      content: JSON.stringify({
        tests: [
          {
            name: 'greeter_ada',
            command: 'python3 src/greeter.py',
            stdin: 'Ada\n',
            assert: {
              stdout_contains: 'HELLO:Ada',
            },
          },
        ],
      }, null, 2),
    })}]`,
  ].join('\n');

  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'Create src/greeter.py and devseek.verify.json for an interactive Python greeter'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 0, result.stderr);
      const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      const validation = events.find(event => event.type === 'validation.completed');
      assert.equal(validation?.passed, true);
      assert.ok(validation.evidenceRefs.some(ref => String(ref).includes('python3 src/greeter.py') && String(ref).includes('HELLO:Ada')));
    });
  }, () => ({ content: response }));
});

test('CLI rejects invalid devseek.verify.json instead of silently passing Python changes', async () => {
  const response = [
    `[TOOL:create_file ${JSON.stringify({
      filePath: 'src/app.py',
      content: 'print("APP")\n',
    })}]`,
    `[TOOL:create_file ${JSON.stringify({
      filePath: 'devseek.verify.json',
      content: '{ "tests": [ { "command": "python3 src/app.py" } ',
    })}]`,
  ].join('\n');

  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'Create src/app.py and devseek.verify.json for a Python app verifier'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /devseek\.verify\.json is not valid JSON/);
    });
  }, () => ({ content: response }));
});

test('CLI requires verifier evidence for explicit requested stdout outputs', async () => {
  const meanOnlySource = [
    'def mean(values):',
    '    return sum(values) / len(values)',
    '',
  ].join('\n');
  const completeSource = [
    'def mean(values):',
    '    return sum(values) / len(values)',
    '',
    'def median(values):',
    '    ordered = sorted(values)',
    '    return ordered[len(ordered) // 2]',
    '',
  ].join('\n');
  let turn = 0;

  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      writeFileSync(path.join(cwd, 'devseek.verify.json'), JSON.stringify({
        commands: [{
          cmd: 'python3',
          args: [
            '-c',
            [
              'import sys',
              'sys.path.insert(0, "src")',
              'from stats import mean, median',
              'print(f"RDW9_MEAN:{mean([2, 4, 6])}")',
              'print(f"RDW9_MEDIAN:{median([2, 4, 6])}")',
            ].join('; '),
          ],
          expectStdoutIncludes: ['RDW9_MEAN:4.0', 'RDW9_MEDIAN:4'],
        }],
      }, null, 2));
      const result = await runCli([bin, 'exec', '--jsonl', [
        'Create or update src/stats.py so the existing project verifier checks both outputs:',
        'RDW9_MEAN:4.0',
        'RDW9_MEDIAN:4',
        '- Return the minimal DevSeek replace_file tool call(s) needed to pass validation.',
      ].join('\n')], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 15000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(seenBodies.length, 2);
      assert.match(seenBodies[1].prompt, /median/);

      const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.deepEqual(
        events.filter(event => event.type === 'validation.completed').map(event => event.passed),
        [false, true],
      );
    });
  }, () => {
    turn += 1;
    if (turn === 1) {
      return {
        content: `[TOOL:create_file ${JSON.stringify({ filePath: 'src/stats.py', content: meanOnlySource })}]`,
      };
    }
    return {
      content: `[TOOL:replace_file ${JSON.stringify({ filePath: 'src/stats.py', content: completeSource })}]`,
    };
  });
});

test('CLI verifies the Bridge failed boundary without degrading the original provider failure', async () => {
  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'bridge server failure smoke'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 5000,
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Bridge HTTP 503/);
      assert.doesNotMatch(result.stdout, /DevSeek CLI error:/);
      const stdoutEvents = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      const errorEvent = stdoutEvents.find(event => event.type === 'error');
      assert.equal(errorEvent?.surface, 'jsonl');
      assert.equal(errorEvent?.severity, 'error');
      const records = readProductEvidenceRecords(cwd);
      const events = records.filter(record => record.record_kind === 'event').map(record => record.event);
      assert.deepEqual(
        events.filter(event => event.type.startsWith('provider.')).map(event => [event.type, event.payload.boundary]),
        [
          ['provider.requested', 'cli-provider-client'],
          ['provider.requested', 'bridge-server'],
          ['provider.failed', 'bridge-server'],
          ['provider.failed', 'cli-provider-client'],
        ],
      );
      assert.equal(events.some(event => event.type === 'evidence.degraded'), false);
      assert.equal(records.at(-1).record_kind, 'seal');
    });
  }, () => ({ statusCode: 503, error: 'test bridge failed' }));
});

test('CLI JSONL SIGTERM cancels transport and settles evidence as cancelled', async () => {
  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      const child = spawn(process.execPath, [bin, 'exec', '--jsonl', 'cancel bridge request smoke'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const close = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`cancel test timed out. stdout=${stdout} stderr=${stderr}`));
        }, 5000);
        child.on('error', error => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (status, signal) => {
          clearTimeout(timer);
          resolve({ status, signal });
        });
      });

      await waitFor(() => seenBodies.length === 1);
      child.kill('SIGTERM');
      const result = await close;

      assert.deepEqual(result, { status: 143, signal: null });
      assert.match(stderr, /DevSeek CLI error:/);
      const stdoutEvents = parseJsonl(stdout);
      const errorEvent = stdoutEvents.find(event => event.type === 'error');
      assert.equal(errorEvent?.surface, 'jsonl');
      assert.equal(errorEvent?.severity, 'error');
      const lifecycle = stdoutEvents.filter(event => event.schema === 'devseek.cli-jsonl-collaboration/v1');
      assert.deepEqual(lifecycle.map(event => event.type), ['cli.run.started', 'cli.run.cancelled']);
      assert.equal(lifecycle.at(-1)?.status, 'cancelled');
      assert.equal(lifecycle.at(-1)?.exitCode, 143);
      assert.deepEqual(lifecycle.at(-1)?.cancel, {
        requested: true,
        signal: 'SIGTERM',
        exitCode: 143,
      });
      const records = readProductEvidenceRecords(cwd);
      const evidenceEvents = records.filter(record => record.record_kind === 'event').map(record => record.event);
      assert.equal(evidenceEvents.at(-1)?.type, 'run.settled');
      assert.equal(evidenceEvents.at(-1)?.payload.status, 'cancelled');
      assert.equal(records.at(-1).record_kind, 'seal');
    });
  }, () => ({ content: 'late bridge response', delayMs: 4000 }));
});

test('CLI bridge failures report diagnostics and degrade when the server boundary is absent', async () => {
  const port = await getUnusedPort();
  await withTempCwdAsync(async (cwd) => {
    const result = await runCli([bin, 'exec', '--jsonl', 'bridge unavailable smoke'], {
      cwd,
      env: {
        ...process.env,
        DEVSEEK_BRIDGE_PORT: String(port),
        DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
      },
      timeout: 5000,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /DevSeek CLI error:/);
    assert.match(result.stderr, /fetch failed|ECONNREFUSED|connect/i);
    assert.match(result.stderr, /expected provider\.failed/);
    const records = readProductEvidenceRecords(cwd);
    const events = records.filter(record => record.record_kind === 'event').map(record => record.event);
    assert.equal(events.some(event => event.type === 'evidence.degraded'), true);
    assert.equal(records.at(-1).record_kind, 'seal');
  });
});

test('CLI reuses ancestor Bridge token when running in a child workspace', async () => {
  const token = 'ancestor-token-for-cli-test';
  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      mkdirSync(path.join(cwd, '.devseek'), { recursive: true });
      mkdirSync(path.join(cwd, 'child'), { recursive: true });
      writeFileSync(path.join(cwd, '.devseek/bridge-token'), `${token}\n`, 'utf8');

      const result = await runCli([bin, 'exec', '--jsonl', 'use ancestor bridge token'], {
        cwd: path.join(cwd, 'child'),
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 5000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(seenBodies.length, 1);
    });
  }, () => ({ content: 'ancestor token ok' }), token);
});

test('CLI attaches mentioned workspace files to Bridge requests', async () => {
  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      mkdirSync(path.join(cwd, 'src'), { recursive: true });
      writeFileSync(path.join(cwd, 'src/existing.cpp'), 'int main() { return 0; }\n', 'utf8');

      const result = await runCli([bin, 'exec', '--jsonl', 'Update src/existing.cpp and preserve current behavior'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 5000,
      });

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /verification-not-run/);
      assert.equal(seenBodies.length, 1);
      assert.deepEqual(seenBodies[0].files, [path.join(cwd, 'src/existing.cpp')]);
    });
  }, () => ({ content: 'No file edits requested.' }));
});

test('CLI attaches mentioned workspace files with non-ASCII path segments', async () => {
  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      mkdirSync(path.join(cwd, 'src/oam/src/lifting/zc_maintenance/docs'), { recursive: true });
      mkdirSync(path.join(cwd, 'src/oam/src/lifting'), { recursive: true });
      writeFileSync(path.join(cwd, 'src/oam/src/lifting/zc_maintenance/docs/维保预警接口文档.md'), '# 接口文档\n', 'utf8');
      writeFileSync(path.join(cwd, 'src/oam/src/lifting/main_control_bus.hpp'), '#pragma once\n', 'utf8');

      const result = await runCli([
        bin,
        'exec',
        '--jsonl',
        '请结合 src/oam/src/lifting/zc_maintenance/docs/维保预警接口文档.md 和 src/oam/src/lifting/main_control_bus.hpp 进行正式项目设计',
      ], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 5000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(seenBodies.length, 1);
      assert.ok(seenBodies[0].files.includes(path.join(cwd, 'src/oam/src/lifting/zc_maintenance/docs/维保预警接口文档.md')));
      assert.ok(seenBodies[0].files.includes(path.join(cwd, 'src/oam/src/lifting/main_control_bus.hpp')));
    });
  }, () => ({ content: 'No file edits requested.' }));
});

test('CLI attaches bounded implicit project context for coding prompts', async () => {
  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      mkdirSync(path.join(cwd, 'src'), { recursive: true });
      writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
        type: 'module',
        scripts: { test: 'node test.mjs' },
      }, null, 2), 'utf8');
      writeFileSync(path.join(cwd, 'src/app.js'), 'export const value = 1;\n', 'utf8');
      writeFileSync(path.join(cwd, 'test.mjs'), 'import assert from "node:assert/strict";\nassert.equal(1, 1);\n', 'utf8');

      const result = await runCli([bin, 'exec', '--jsonl', 'Add a new feature to this small project and run validation'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 5000,
      });

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /verification-not-run/);
      assert.equal(seenBodies.length, 1);
      assert.ok(seenBodies[0].files.includes(path.join(cwd, 'package.json')));
      assert.ok(seenBodies[0].files.includes(path.join(cwd, 'src/app.js')));
      assert.ok(seenBodies[0].files.includes(path.join(cwd, 'test.mjs')));
    });
  }, () => ({ content: 'No file edits requested.' }));
});

test('CLI allows python verifier commands from devseek.verify.json', async () => {
  const response = [
    `[TOOL:create_file ${JSON.stringify({
      filePath: 'src/word_stats.py',
      content: [
        'def count_words(text):',
        '    return len([part for part in text.split() if part])',
        '',
      ].join('\n'),
    })}]`,
    `[TOOL:create_file ${JSON.stringify({
      filePath: 'devseek.verify.json',
      content: JSON.stringify({
        commands: [
          {
            cmd: 'python3',
            args: ['-c', 'from src.word_stats import count_words; print("PYWORDS:" + str(count_words("one two two")))'],
            expectStdoutIncludes: 'PYWORDS:3',
          },
        ],
      }, null, 2),
    })}]`,
  ].join('\n');

  await withTestBridge(async ({ port }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', 'Create src/word_stats.py and devseek.verify.json for a Python word counter, then verify it'], {
        cwd,
        env: {
          ...process.env,
          DEVSEEK_BRIDGE_PORT: String(port),
          DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        },
        timeout: 10000,
      });

      assert.equal(result.status, 0, result.stderr);
      const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      const validation = events.find(event => event.type === 'validation.completed');
      assert.equal(validation?.passed, true);
      assert.ok(validation.evidenceRefs.some(ref => String(ref).includes('python3') && String(ref).includes('PYWORDS:3')));
    });
  }, () => ({ content: response }));
});

function runCli(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out. stdout=${stdout} stderr=${stderr}`));
    }, options.timeout);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function waitFor(predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('waitFor timed out'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

async function withTestBridge(fn, responder = () => ({ content: 'delayed bridge response', delayMs: 80 }), expectedToken) {
  const seenBodies = [];
  const seenHeaders = [];
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat') {
      res.writeHead(404).end();
      return;
    }
    if (expectedToken && req.headers['x-devseek-token'] !== expectedToken) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'bad token' }));
      return;
    }

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      seenBodies.push(body);
      seenHeaders.push(req.headers);
      const runId = String(req.headers['x-devseek-run-id'] || '');
      const workspaceRoot = String(req.headers['x-devseek-trace-workspace-root'] || '');
      const operationId = String(req.headers['x-devseek-operation-id'] || '');
      const authorityToken = String(req.headers['x-devseek-evidence-authority'] || '');
      const evidence = runId && workspaceRoot && operationId && authorityToken
        ? ProductRunEvidenceSession.forWorkspace({
          workspaceRoot,
          runId,
          surface: 'bridge',
          authority: { role: 'participant', token: authorityToken },
        })
        : undefined;
      const recordEvidence = (type) => evidence?.record({
        type,
        idempotencyKey: productRunEvidenceIdempotencyKey(`test-bridge-${type}`, { operationId }),
        payload: {
          operation_id: operationId,
          boundary: 'bridge-server',
          status: type.slice('provider.'.length),
          trust: 'product-runtime-observation',
          provider: 'test-bridge',
        },
      });
      recordEvidence('provider.requested');
      const response = responder(body);
      if (body.stream === false) {
        if (response.statusCode && response.statusCode >= 400) {
          recordEvidence('provider.failed');
          res.writeHead(response.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: response.error ?? 'test bridge failure' }));
          return;
        }
        let finishTimer;
        let finished = false;
        res.on('close', () => {
          if (finishTimer) clearTimeout(finishTimer);
          if (!finished) recordEvidence('provider.failed');
        });
        const finish = () => {
          finished = true;
          recordEvidence('provider.completed');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ content: response.content }));
        };
        if (response.delayMs) {
          finishTimer = setTimeout(finish, response.delayMs);
        } else {
          finish();
        }
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      setTimeout(() => {
        const first = response.content.slice(0, Math.max(1, Math.floor(response.content.length / 2)));
        res.write(`data: ${JSON.stringify({ delta: `\u0000RESET\u0000${first}`, done: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ delta: `\u0000RESET\u0000${response.content}`, done: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ delta: '', done: true })}\n\n`);
        recordEvidence('provider.completed');
        res.end();
      }, response.delayMs ?? 0);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn({ port: server.address().port, seenBodies, seenHeaders });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function getUnusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
