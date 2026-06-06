#!/usr/bin/env node
/**
 * DevSeek bridge performance harness.
 *
 * Runs a fixed set of chat cases against bridge /chat and reports latency,
 * output size, and failures. This is intended for repeatable optimization
 * cycles: baseline -> optimize -> rerun.
 */

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

const BASE_URL = process.env.DS_BRIDGE_URL || 'http://127.0.0.1:3721';
const OUT_DIR = process.env.DS_PERF_OUT_DIR || path.join(process.cwd(), 'artifacts', 'perf-reports');

const CASES = [
  {
    id: 'chat-short',
    mode: 'fast',
    prompt: '请简要说明 C++ 中 RAII 的作用，并给一个 8 行内示例。',
  },
  {
    id: 'code-review',
    mode: 'fast',
    prompt: '请评审以下伪代码的并发风险并给出修复建议：使用全局 map 缓存并在多线程读写。',
  },
  {
    id: 'plan-heavy',
    mode: 'r1',
    prompt: '设计一个最小可用的多轮 Agent 执行链路：规划、执行、验证、回滚，给出关键状态机和失败处理。',
  },
];

async function status() {
  const res = await fetch(`${BASE_URL}/status`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`status http ${res.status}`);
  return res.json();
}

async function runCase(testCase) {
  const body = {
    prompt: testCase.prompt,
    mode: testCase.mode,
    stream: false,
    timeoutMs: 120000,
    newSession: false,
  };

  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(130000),
  });

  let responseJson = null;
  let parseError = null;
  try {
    responseJson = await res.json();
  } catch (e) {
    parseError = String(e && e.message ? e.message : e);
  }

  const t1 = performance.now();
  const content = responseJson && typeof responseJson.content === 'string' ? responseJson.content : '';
  const apiError = responseJson && responseJson.error ? String(responseJson.error) : '';
  return {
    id: testCase.id,
    mode: testCase.mode,
    ok: res.ok && !apiError && !parseError,
    status: res.status,
    latencyMs: Math.round(t1 - t0),
    outputChars: content.length,
    error: parseError || apiError || '',
  };
}

function printSummary(results) {
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;
  const latencies = results.filter(r => r.ok).map(r => r.latencyMs);
  const p50 = latencies.length ? latencies.slice().sort((a, b) => a - b)[Math.floor((latencies.length - 1) * 0.5)] : 0;
  const p95 = latencies.length ? latencies.slice().sort((a, b) => a - b)[Math.floor((latencies.length - 1) * 0.95)] : 0;

  console.log('\n=== DevSeek Bridge Perf Cases ===');
  for (const r of results) {
    console.log([
      r.ok ? 'PASS' : 'FAIL',
      r.id,
      `mode=${r.mode}`,
      `status=${r.status}`,
      `latency=${r.latencyMs}ms`,
      `chars=${r.outputChars}`,
      r.error ? `error=${r.error}` : '',
    ].filter(Boolean).join(' | '));
  }
  console.log(`\nSummary: pass=${okCount}, fail=${failCount}, p50=${p50}ms, p95=${p95}ms`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let statusPayload;
  try {
    statusPayload = await status();
  } catch (e) {
    console.error(`Bridge not ready at ${BASE_URL}: ${String(e && e.message ? e.message : e)}`);
    process.exit(2);
  }

  if (!statusPayload || !statusPayload.browserReady) {
    console.error('Bridge is up but DeepSeek web session is not ready (browserReady=false). Please login first.');
    process.exit(3);
  }

  const results = [];
  for (const c of CASES) {
    try {
      const r = await runCase(c);
      results.push(r);
    } catch (e) {
      results.push({
        id: c.id,
        mode: c.mode,
        ok: false,
        status: 0,
        latencyMs: 0,
        outputChars: 0,
        error: String(e && e.message ? e.message : e),
      });
    }
  }

  printSummary(results);

  const report = {
    createdAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    cases: CASES.map(c => ({ id: c.id, mode: c.mode })),
    results,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(OUT_DIR, `bridge-perf-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${outFile}`);

  if (results.some(r => !r.ok)) process.exit(1);
}

main();
