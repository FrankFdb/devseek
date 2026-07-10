import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const bin = path.join(cliRoot, 'dist/index.js');

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

test('CLI JSONL mode emits parseable AgentEvent lines', () => {
  const stdout = withTempCwd((cwd) => {
    return execFileSync(process.execPath, [bin, 'exec', '--jsonl', '--mock', 'phase10 cli jsonl smoke'], {
      cwd,
      encoding: 'utf8',
    });
  });

  const events = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => event.type), [
    'chat.started',
    'provider.selected',
    'chat.completed',
  ]);
  assert.equal(events.at(-1).response, 'mock: phase10 cli jsonl smoke');
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

test('CLI bridge text mode streams SSE and reports delayed provider wait on stderr', async () => {
  await withTestBridge(async ({ port, seenBodies }) => {
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
    });
  });
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
      const result = await runCli([bin, 'exec', '--jsonl', 'apply loose tool json'], {
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

test('CLI validates explicit C++ stdout expectations before passing quality gate', async () => {
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
      assert.match(seenBodies[1].prompt, /Program output for src\/todo\.cpp did not match the requested stdout/);
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

test('CLI preserves single-quoted escaped newlines in loose XML tool content', async () => {
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
      const result = await runCli([bin, 'exec', '--jsonl', 'Create an interactive Python greeter and tests verifier'], {
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
      const result = await runCli([bin, 'exec', '--jsonl', 'Create a Python app with verifier'], {
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
  const meanOnlyVerifier = JSON.stringify({
    tests: [
      {
        command: 'python3 -c "import sys; sys.path.insert(0, \'src\'); from stats import mean; print(f\'RDW9_MEAN:{mean([2, 4, 6])}\')"',
        assert: { stdout_contains: 'RDW9_MEAN:4.0' },
      },
    ],
  }, null, 2);
  const completeVerifier = JSON.stringify({
    tests: [
      {
        command: 'python3 -c "import sys; sys.path.insert(0, \'src\'); from stats import mean, median; print(f\'RDW9_MEAN:{mean([2, 4, 6])}\'); print(f\'RDW9_MEDIAN:{median([2, 4, 6])}\')"',
        assert: { stdout_contains: ['RDW9_MEAN:4.0', 'RDW9_MEDIAN:4'] },
      },
    ],
  }, null, 2);
  let turn = 0;

  await withTestBridge(async ({ port, seenBodies }) => {
    await withTempCwdAsync(async (cwd) => {
      const result = await runCli([bin, 'exec', '--jsonl', [
        'Update devseek.verify.json so validation checks both outputs:',
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
      assert.match(seenBodies[1].prompt, /did not provide evidence for requested stdout: RDW9_MEDIAN:4/);

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
        content: [
          `[TOOL:create_file ${JSON.stringify({ filePath: 'src/stats.py', content: meanOnlySource })}]`,
          `[TOOL:create_file ${JSON.stringify({ filePath: 'devseek.verify.json', content: meanOnlyVerifier })}]`,
        ].join('\n'),
      };
    }
    return {
      content: [
        `[TOOL:replace_file ${JSON.stringify({ filePath: 'src/stats.py', content: completeSource })}]`,
        `[TOOL:replace_file ${JSON.stringify({ filePath: 'devseek.verify.json', content: completeVerifier })}]`,
      ].join('\n'),
    };
  });
});

test('CLI bridge failures report diagnostics on stderr', async () => {
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

      assert.equal(result.status, 0, result.stderr);
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

      assert.equal(result.status, 0, result.stderr);
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
      const result = await runCli([bin, 'exec', '--jsonl', 'Create a Python word counter and verify it'], {
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

async function withTestBridge(fn, responder = () => ({ content: 'delayed bridge response', delayMs: 80 }), expectedToken) {
  const seenBodies = [];
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
      const response = responder(body);
      if (body.stream === false) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ content: response.content }));
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
        res.end();
      }, response.delayMs ?? 0);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn({ port: server.address().port, seenBodies });
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
