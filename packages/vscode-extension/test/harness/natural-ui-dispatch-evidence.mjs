import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createNaturalUiPromptIdentity(prompt) {
  const text = String(prompt || '');
  return Object.freeze({
    length: text.length,
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
  });
}

export function captureNaturalUiDispatchBaseline(runsDir, capturedAtMs = Date.now()) {
  const files = {};
  for (const name of listRunLogs(runsDir)) {
    const stat = safeStat(path.join(runsDir, name));
    if (!stat) continue;
    files[name] = {
      size: stat.size,
      dev: stat.dev,
      ino: stat.ino,
    };
  }
  return Object.freeze({
    runsDir,
    capturedAtMs,
    capturedAt: new Date(capturedAtMs).toISOString(),
    files: Object.freeze(files),
  });
}

export async function waitForNaturalUiForegroundDispatch({
  baseline,
  expectedPrompt,
  timeoutMs,
  pollIntervalMs = 250,
}) {
  const cursors = new Map();
  const diagnostics = {
    invalidLines: 0,
    staleEvents: 0,
    promptMismatches: 0,
  };
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const name of listRunLogs(baseline.runsDir)) {
      const absolutePath = path.join(baseline.runsDir, name);
      const stat = safeStat(absolutePath);
      if (!stat) continue;
      const cursor = resolveCursor(cursors.get(name), baseline.files[name], stat);
      const buffer = safeRead(absolutePath);
      if (!buffer || buffer.length < cursor.offset) continue;

      const next = consumeJsonLines(cursor, buffer.subarray(cursor.offset));
      next.offset = buffer.length;
      next.dev = stat.dev;
      next.ino = stat.ino;
      cursors.set(name, next);

      for (const line of next.lines) {
        const event = parseJsonLine(line);
        if (!event) {
          diagnostics.invalidLines += 1;
          continue;
        }
        if (event.event !== 'agent-run-started'
          || event.data?.workloadRole === 'background-maintenance') {
          continue;
        }
        if (event.data?.prompt?.length !== expectedPrompt.length
          || event.data?.prompt?.sha256 !== expectedPrompt.sha256) {
          diagnostics.promptMismatches += 1;
          continue;
        }
        const eventAtMs = Date.parse(event.ts || '');
        if (!Number.isFinite(eventAtMs)
          || eventAtMs < baseline.capturedAtMs
          || typeof event.runId !== 'string'
          || event.runId.length === 0) {
          diagnostics.staleEvents += 1;
          continue;
        }
        return {
          observed: true,
          runId: event.runId,
          ts: event.ts,
          prompt: expectedPrompt,
          evidence: {
            log: absolutePath,
            baselineCapturedAt: baseline.capturedAt,
          },
          diagnostics,
        };
      }
    }
    await delay(pollIntervalMs);
  }

  return {
    observed: false,
    runId: '',
    ts: '',
    prompt: expectedPrompt,
    evidence: {
      log: '',
      baselineCapturedAt: baseline.capturedAt,
    },
    diagnostics,
  };
}

function resolveCursor(current, baselineFile, stat) {
  if (current && current.dev === stat.dev && current.ino === stat.ino && current.offset <= stat.size) {
    return current;
  }
  const sameBaselineFile = baselineFile
    && baselineFile.dev === stat.dev
    && baselineFile.ino === stat.ino
    && baselineFile.size <= stat.size;
  return {
    offset: sameBaselineFile ? baselineFile.size : 0,
    residual: Buffer.alloc(0),
    dev: stat.dev,
    ino: stat.ino,
  };
}

function consumeJsonLines(cursor, appended) {
  const combined = cursor.residual.length > 0
    ? Buffer.concat([cursor.residual, appended])
    : appended;
  const lines = [];
  let start = 0;
  for (let index = 0; index < combined.length; index += 1) {
    if (combined[index] !== 0x0a) continue;
    lines.push(combined.subarray(start, index).toString('utf8').replace(/\r$/u, ''));
    start = index + 1;
  }
  return {
    ...cursor,
    lines,
    residual: combined.subarray(start),
  };
}

function listRunLogs(runsDir) {
  try {
    return fs.readdirSync(runsDir).filter(name => name.endsWith('.log')).sort();
  } catch {
    return [];
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
