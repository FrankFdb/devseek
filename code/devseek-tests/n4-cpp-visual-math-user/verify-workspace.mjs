import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePaths = Object.freeze([
  'include/math_model.hpp',
  'include/lesson_controller.hpp',
  'include/raster_canvas.hpp',
  'include/x11_app.hpp',
  'src/main.cpp',
  'src/math_model.cpp',
  'src/lesson_controller.cpp',
  'src/raster_canvas.cpp',
  'src/x11_app.cpp',
]);

export function verifyWorkspace(workspace, stage, evidenceDir) {
  const checks = [];
  const artifacts = {};
  const root = path.resolve(workspace);
  const evidence = path.resolve(evidenceDir);
  fs.mkdirSync(evidence, { recursive: true });

  check(checks, 'source-contract', sourcePaths.every(rel => fileHasContent(root, rel)), {
    missing: sourcePaths.filter(rel => !fileHasContent(root, rel)),
  });
  const sourceText = sourcePaths
    .filter(rel => fileHasContent(root, rel))
    .map(rel => fs.readFileSync(path.join(root, rel), 'utf8'))
    .join('\n');
  const unfinishedSource = /(?:TODO|FIXME|placeholder|future implementation|not implemented)/iu;
  check(checks, 'source-hygiene', !unfinishedSource.test(sourceText) && !/\bsystem\s*\(/u.test(sourceText), {
    unfinishedImplementation: unfinishedSource.test(sourceText),
    systemCall: /\bsystem\s*\(/u.test(sourceText),
  });

  const publicTest = run('./test.sh', [], root, 180_000);
  artifacts.publicTest = recordCommand(evidence, 'public-test', publicTest);
  check(checks, 'public-build-and-self-test', publicTest.status === 0, commandSummary(publicTest));

  if (stage >= 2 && publicTest.status === 0) {
    const result = runVisualCase(root, evidence, 'fraction-number-line', 'assets/fraction-number-line.actions', 800, 600);
    artifacts.fractionNumberLine = result.artifacts;
    check(checks, 'fraction-number-line-command', result.command.status === 0, commandSummary(result.command));
    check(checks, 'fraction-number-line-state', result.state?.lesson === 'number-line'
      && result.state?.fraction?.total === 4
      && result.state?.fraction?.selected === 3
      && result.state?.numberLine?.marker === 6
      && Number(result.state?.handledActions) >= 5, result.state);
    check(checks, 'fraction-number-line-pixels', ppmLooksGraphical(result.ppm), result.ppm);
  }

  if (stage >= 3 && publicTest.status === 0) {
    const result = runVisualCase(root, evidence, 'quiz', 'assets/quiz.actions', 800, 600);
    artifacts.quiz = result.artifacts;
    check(checks, 'quiz-command', result.command.status === 0, commandSummary(result.command));
    check(checks, 'quiz-state', result.state?.lesson === 'quiz'
      && result.state?.quiz?.answered === 2
      && result.state?.quiz?.correct === 2
      && typeof result.state?.quiz?.feedback === 'string'
      && result.state.quiz.feedback.trim().length > 0, result.state);
    check(checks, 'quiz-pixels', ppmLooksGraphical(result.ppm), result.ppm);
  }

  if (stage >= 4 && publicTest.status === 0) {
    for (const [name, width, height] of [['compact', 640, 480], ['wide', 1024, 640]]) {
      const result = runVisualCase(root, evidence, name, 'assets/fraction-number-line.actions', width, height);
      artifacts[name] = result.artifacts;
      check(checks, `${name}-render-command`, result.command.status === 0, commandSummary(result.command));
      check(checks, `${name}-render-size`, result.ppm?.width === width && result.ppm?.height === height, result.ppm);
      check(checks, `${name}-render-pixels`, ppmLooksGraphical(result.ppm), result.ppm);
    }

    const invalid = run(path.join(root, 'build/math_visual_lab'), [
      '--script', path.join(root, 'assets/invalid.actions'),
      '--snapshot', path.join(evidence, 'invalid.ppm'),
      '--state', path.join(evidence, 'invalid.json'),
    ], root, 30_000);
    artifacts.invalid = recordCommand(evidence, 'invalid-actions', invalid);
    check(checks, 'invalid-action-rejected', invalid.status !== 0 && /(?:invalid|range|total|1\.\.12)/iu.test(`${invalid.stdout}\n${invalid.stderr}`), commandSummary(invalid));

    const smoke = run(path.join(root, 'build/math_visual_lab'), [
      '--smoke-frames', '3', '--width', '800', '--height', '600',
    ], root, 30_000, { DISPLAY: process.env.DISPLAY || ':0' });
    artifacts.x11Smoke = recordCommand(evidence, 'x11-smoke', smoke);
    check(checks, 'real-x11-window-smoke', smoke.status === 0, commandSummary(smoke));

    const sanitizer = runSanitizerSmoke(root, evidence);
    artifacts.sanitizer = sanitizer.artifacts;
    check(checks, 'sanitizer-configure', sanitizer.configure.status === 0, commandSummary(sanitizer.configure));
    check(checks, 'sanitizer-build', sanitizer.build?.status === 0, commandSummary(sanitizer.build));
    check(checks, 'sanitizer-x11-repeated-frame', sanitizer.smoke?.status === 0, commandSummary(sanitizer.smoke));

    const readme = fileText(root, 'README.md');
    check(checks, 'operator-readme', /(?:build|cmake)/iu.test(readme)
      && /(?:keyboard|mouse|键盘|鼠标)/iu.test(readme)
      && /--smoke-frames/u.test(readme), { bytes: Buffer.byteLength(readme) });
  }

  const report = {
    schemaVersion: 'devseek.n4-cpp-visual-math-verification/v1',
    workspace: root,
    stage,
    ok: checks.every(item => item.ok),
    checks,
    artifacts,
    verifiedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(evidence, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function runSanitizerSmoke(root, evidence) {
  const buildDir = path.join(evidence, 'sanitizer-build');
  const configure = run('cmake', [
    '-S', root,
    '-B', buildDir,
    '-DCMAKE_BUILD_TYPE=Debug',
    '-DCMAKE_CXX_FLAGS=-fsanitize=address,undefined -fno-omit-frame-pointer',
    '-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined',
  ], root, 60_000);
  const artifacts = {
    configure: recordCommand(evidence, 'sanitizer-configure', configure),
  };
  if (configure.status !== 0) return { configure, artifacts };

  const build = run('cmake', ['--build', buildDir, '--parallel', '2'], root, 180_000);
  artifacts.build = recordCommand(evidence, 'sanitizer-build', build);
  if (build.status !== 0) return { configure, build, artifacts };

  const smoke = run(path.join(buildDir, 'math_visual_lab'), [
    '--smoke-frames', '3', '--width', '800', '--height', '600',
  ], root, 30_000, {
    ASAN_OPTIONS: 'detect_leaks=0:halt_on_error=1',
    UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1',
    DISPLAY: process.env.DISPLAY || ':0',
  });
  artifacts.smoke = recordCommand(evidence, 'sanitizer-x11-smoke', smoke);
  return { configure, build, smoke, artifacts };
}

function runVisualCase(root, evidence, name, actionsRel, width, height) {
  const snapshot = path.join(evidence, `${name}.ppm`);
  const statePath = path.join(evidence, `${name}.json`);
  const command = run(path.join(root, 'build/math_visual_lab'), [
    '--script', path.join(root, actionsRel),
    '--snapshot', snapshot,
    '--state', statePath,
    '--width', String(width),
    '--height', String(height),
  ], root, 30_000);
  const commandLog = recordCommand(evidence, `${name}-command`, command);
  const state = readJson(statePath);
  const ppm = readPpmStats(snapshot);
  return {
    command,
    state,
    ppm,
    artifacts: { snapshot, statePath, commandLog },
  };
}

export function readPpmStats(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const bytes = fs.readFileSync(filePath);
  const parsed = ppmHeader(bytes);
  if (!parsed || parsed.maxValue <= 0 || parsed.maxValue > 65_535) return null;
  const colors = new Map();
  let sampled = 0;
  if (parsed.magic === 'P6' && parsed.maxValue <= 255) {
    const pixelCount = parsed.width * parsed.height;
    const stride = Math.max(1, Math.floor(pixelCount / 25_000));
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = parsed.dataOffset + pixel * 3;
      if (offset + 2 >= bytes.length) break;
      addColor(colors, bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      sampled += 1;
    }
  } else if (parsed.magic === 'P3') {
    const values = bytes.subarray(parsed.dataOffset).toString('ascii').trim().split(/\s+/u).map(Number);
    const pixelCount = Math.floor(values.length / 3);
    const stride = Math.max(1, Math.floor(pixelCount / 25_000));
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = pixel * 3;
      addColor(colors, values[offset], values[offset + 1], values[offset + 2]);
      sampled += 1;
    }
  }
  const dominant = Math.max(0, ...colors.values());
  return {
    filePath,
    magic: parsed.magic,
    width: parsed.width,
    height: parsed.height,
    maxValue: parsed.maxValue,
    bytes: bytes.length,
    sampledPixels: sampled,
    uniqueSampledColors: colors.size,
    nonDominantRatio: sampled > 0 ? Number((1 - dominant / sampled).toFixed(4)) : 0,
  };
}

function ppmHeader(bytes) {
  let offset = 0;
  const tokens = [];
  while (tokens.length < 4 && offset < bytes.length) {
    while (offset < bytes.length && /\s/u.test(String.fromCharCode(bytes[offset]))) offset += 1;
    if (bytes[offset] === 35) {
      while (offset < bytes.length && bytes[offset] !== 10) offset += 1;
      continue;
    }
    const start = offset;
    while (offset < bytes.length && !/\s/u.test(String.fromCharCode(bytes[offset]))) offset += 1;
    if (offset > start) tokens.push(bytes.subarray(start, offset).toString('ascii'));
  }
  const [magic, width, height, maxValue] = tokens;
  if (!['P3', 'P6'].includes(magic)) return null;
  if (offset >= bytes.length || !/\s/u.test(String.fromCharCode(bytes[offset]))) return null;
  offset += bytes[offset] === 13 && bytes[offset + 1] === 10 ? 2 : 1;
  return { magic, width: Number(width), height: Number(height), maxValue: Number(maxValue), dataOffset: offset };
}

export function ppmLooksGraphical(stats) {
  return Boolean(stats
    && stats.width >= 640
    && stats.height >= 480
    && stats.uniqueSampledColors >= 6
    && stats.nonDominantRatio >= 0.02);
}

function addColor(colors, red, green, blue) {
  const key = `${red},${green},${blue}`;
  colors.set(key, (colors.get(key) || 0) + 1);
}

function run(command, args, cwd, timeout, extraEnv = {}) {
  const result = cp.spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...extraEnv },
  });
  return {
    command: [command, ...args],
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error.message || result.error) : '',
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function recordCommand(evidence, name, result) {
  const filePath = path.join(evidence, `${name}.log`);
  fs.writeFileSync(filePath, [
    `$ ${result.command.join(' ')}`,
    `status=${result.status} signal=${result.signal || ''} error=${result.error}`,
    result.stdout,
    result.stderr,
  ].join('\n'), 'utf8');
  return filePath;
}

function commandSummary(result) {
  if (!result) {
    return {
      status: null,
      signal: null,
      error: 'Skipped because an earlier sanitizer step failed.',
      stdoutTail: '',
      stderrTail: '',
    };
  }
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdoutTail: result.stdout.slice(-2_000),
    stderrTail: result.stderr.slice(-2_000),
  };
}

function check(checks, id, ok, details) {
  checks.push({ id, ok: Boolean(ok), details });
}

function fileHasContent(root, rel) {
  const filePath = path.join(root, rel);
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
}

function fileText(root, rel) {
  const filePath = path.join(root, rel);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  const workspace = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const stage = Number(process.argv[3] || 4);
  const evidence = process.argv[4]
    ? path.resolve(process.argv[4])
    : path.join(workspace, '.devseek-visual-math-verification');
  if (!workspace || !Number.isInteger(stage) || stage < 1 || stage > 4) {
    throw new Error('Usage: node verify-workspace.mjs <workspace> <stage 1..4> [evidence-dir]');
  }
  const report = verifyWorkspace(workspace, stage, evidence);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
