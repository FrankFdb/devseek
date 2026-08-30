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
const unfinishedSource = /(?:\bTODO\b|\bFIXME\b|\bplaceholder\b|\bfuture implementation\b|\bnot implemented\b)/iu;

export function hasUnfinishedImplementation(sourceText) {
  return unfinishedSource.test(sourceText);
}

const interactionMethods = Object.freeze([
  'handleMouseClick',
  'handleFractionClick',
  'handleNumberLineClick',
]);

export function findInteractionDispatcherCycles(sourceText) {
  const methodBodies = new Map(interactionMethods.map(name => [
    name,
    extractCppFunctionCode(sourceText, `LessonController::${name}`),
  ]));
  const edges = new Map(interactionMethods.map(name => {
    const body = methodBodies.get(name);
    const calls = body === null
      ? []
      : interactionMethods.filter(candidate => new RegExp(`\\b${candidate}\\s*\\(`, 'u').test(body));
    return [name, calls];
  }));
  const cycles = new Set();

  function visit(method, path) {
    for (const called of edges.get(method) ?? []) {
      const cycleStart = path.indexOf(called);
      if (cycleStart >= 0) {
        cycles.add([...path.slice(cycleStart), called].join(' -> '));
        continue;
      }
      visit(called, [...path, called]);
    }
  }

  visit('handleMouseClick', ['handleMouseClick']);
  return [...cycles].sort();
}

export function inspectScriptRenderOwnership(sourceText) {
  const body = extractCppFunctionCode(sourceText, 'runScript');
  if (body === null) {
    return {
      functionFound: false,
      delegatesToLessonController: false,
      directLessonRendererCalls: [],
    };
  }

  const directLessonRendererCalls = ['renderFraction', 'renderNumberLine', 'renderQuiz']
    .filter(name => new RegExp(`\\bcanvas\\s*\\.\\s*${name}\\s*\\(`, 'u').test(body));
  return {
    functionFound: true,
    delegatesToLessonController: /\bcontroller\s*\.\s*render\s*\(\s*canvas\s*\)/u.test(body),
    directLessonRendererCalls,
  };
}

function extractCppFunctionCode(sourceText, qualifiedName) {
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const signature = new RegExp(`\\b${escapedName}\\s*\\([^;{}]*\\)\\s*(?:const\\s*)?(?:noexcept\\s*)?\\{`, 'u');
  const match = signature.exec(sourceText);
  if (!match) return null;

  const openingBrace = match.index + match[0].lastIndexOf('{');
  let depth = 0;
  let state = 'code';
  let code = '';
  for (let index = openingBrace; index < sourceText.length; index += 1) {
    const current = sourceText[index];
    const next = sourceText[index + 1];
    if (state === 'line-comment') {
      if (current === '\n') {
        state = 'code';
        code += '\n';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (state === 'string' || state === 'character') {
      if (current === '\\') {
        index += 1;
      } else if ((state === 'string' && current === '"') || (state === 'character' && current === "'")) {
        state = 'code';
      }
      continue;
    }
    if (current === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      state = current === '"' ? 'string' : 'character';
      continue;
    }
    if (current === '{') {
      depth += 1;
      if (depth > 1) code += current;
      continue;
    }
    if (current === '}') {
      depth -= 1;
      if (depth === 0) return code;
      code += current;
      continue;
    }
    if (depth > 0) code += current;
  }
  return null;
}

export function verifyWorkspace(workspace, stage, evidenceDir) {
  const checks = [];
  const artifacts = {};
  const root = path.resolve(workspace);
  const evidence = path.resolve(evidenceDir);
  fs.mkdirSync(evidence, { recursive: true });

  check(checks, 'source-contract', sourcePaths.every(rel => fileHasContent(root, rel)), {
    missing: sourcePaths.filter(rel => !fileHasContent(root, rel)),
  });
  const existingSources = sourcePaths
    .filter(rel => fileHasContent(root, rel))
    .map(rel => ({ rel, text: fs.readFileSync(path.join(root, rel), 'utf8') }));
  const sourceText = existingSources.map(source => source.text).join('\n');
  const unfinishedImplementation = hasUnfinishedImplementation(sourceText);
  const unfinishedMatches = sourceMatches(existingSources, unfinishedSource);
  const systemCallMatches = sourceMatches(existingSources, /\bsystem\s*\(/u);
  check(checks, 'source-hygiene', !unfinishedImplementation && !/\bsystem\s*\(/u.test(sourceText), {
    unfinishedImplementation,
    systemCall: /\bsystem\s*\(/u.test(sourceText),
    unfinishedMatches,
    systemCallMatches,
  }, {
    unfinishedImplementation: false,
    systemCall: false,
  });

  if (stage >= 2) {
    const lessonControllerSource = existingSources.find(source => source.rel === 'src/lesson_controller.cpp')?.text ?? '';
    const interactionCycles = findInteractionDispatcherCycles(lessonControllerSource);
    check(checks, 'interaction-dispatch-acyclic', interactionCycles.length === 0, {
      cycles: interactionCycles,
    }, {
      cycles: [],
    });

    const mainSource = existingSources.find(source => source.rel === 'src/main.cpp')?.text ?? '';
    const scriptRenderOwnership = inspectScriptRenderOwnership(mainSource);
    check(checks, 'script-render-shares-controller', scriptRenderOwnership.functionFound
      && scriptRenderOwnership.delegatesToLessonController
      && scriptRenderOwnership.directLessonRendererCalls.length === 0, scriptRenderOwnership, {
      functionFound: true,
      delegatesToLessonController: true,
      directLessonRendererCalls: [],
    });
  }

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
      && Number(result.state?.handledActions) >= 5, result.state, {
      lesson: 'number-line',
      handledActions: { minimum: 5 },
      fraction: { selected: 3, total: 4 },
      numberLine: { marker: 6 },
    });
    check(checks, 'fraction-number-line-pixels', ppmLooksGraphical(result.ppm), visualCaseDetails(result), graphicalPpmExpectation());
  }

  if (stage >= 3 && publicTest.status === 0) {
    const result = runVisualCase(root, evidence, 'quiz', 'assets/quiz.actions', 800, 600);
    artifacts.quiz = result.artifacts;
    check(checks, 'quiz-command', result.command.status === 0, commandSummary(result.command));
    check(checks, 'quiz-state', result.state?.lesson === 'quiz'
      && result.state?.quiz?.answered === 2
      && result.state?.quiz?.correct === 2
      && typeof result.state?.quiz?.feedback === 'string'
      && result.state.quiz.feedback.trim().length > 0, result.state, {
      lesson: 'quiz',
      quiz: { answered: 2, correct: 2, feedback: { nonEmptyString: true } },
    });
    check(checks, 'quiz-pixels', ppmLooksGraphical(result.ppm), visualCaseDetails(result), graphicalPpmExpectation());
  }

  if (stage >= 4 && publicTest.status === 0) {
    for (const [name, width, height] of [['compact', 640, 480], ['wide', 1024, 640]]) {
      const result = runVisualCase(root, evidence, name, 'assets/fraction-number-line.actions', width, height);
      artifacts[name] = result.artifacts;
      check(checks, `${name}-render-command`, result.command.status === 0, commandSummary(result.command));
      check(checks, `${name}-render-size`, result.ppm?.width === width && result.ppm?.height === height, result.ppm);
      check(checks, `${name}-render-pixels`, ppmLooksGraphical(result.ppm), visualCaseDetails(result), graphicalPpmExpectation());
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
    reproduction: {
      cwd: '.',
      command: `./build/math_visual_lab --script ${actionsRel} --snapshot verification-${name}.ppm --state verification-${name}.json --width ${width} --height ${height}`,
      artifactPolicy: 'Generate diagnostic outputs inside the selected workspace. Evidence artifact paths outside it are read-only and are not tool-authorized.',
    },
    artifacts: { snapshot, statePath, commandLog },
  };
}

function visualCaseDetails(result) {
  const stats = result.ppm;
  return {
    reproduction: result.reproduction,
    ppm: stats ? {
      width: stats.width,
      height: stats.height,
      sampledPixels: stats.sampledPixels,
      uniqueSampledColors: stats.uniqueSampledColors,
      nonDominantRatio: stats.nonDominantRatio,
      nonDominantSampledPixels: stats.nonDominantSampledPixels,
      nonDominantBounds: stats.nonDominantBounds,
      nonDominantQuadrants: stats.nonDominantQuadrants,
      topSampledColors: stats.topSampledColors,
    } : null,
  };
}

export function readPpmStats(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const bytes = fs.readFileSync(filePath);
  const parsed = ppmHeader(bytes);
  if (!parsed || parsed.maxValue <= 0 || parsed.maxValue > 65_535) return null;
  const colors = new Map();
  const samples = [];
  let sampled = 0;
  if (parsed.magic === 'P6' && parsed.maxValue <= 255) {
    const pixelCount = parsed.width * parsed.height;
    const stride = Math.max(1, Math.floor(pixelCount / 25_000));
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = parsed.dataOffset + pixel * 3;
      if (offset + 2 >= bytes.length) break;
      const key = addColor(colors, bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      samples.push({ key, x: pixel % parsed.width, y: Math.floor(pixel / parsed.width) });
      sampled += 1;
    }
  } else if (parsed.magic === 'P3') {
    const values = bytes.subarray(parsed.dataOffset).toString('ascii').trim().split(/\s+/u).map(Number);
    const pixelCount = Math.floor(values.length / 3);
    const stride = Math.max(1, Math.floor(pixelCount / 25_000));
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const offset = pixel * 3;
      const key = addColor(colors, values[offset], values[offset + 1], values[offset + 2]);
      samples.push({ key, x: pixel % parsed.width, y: Math.floor(pixel / parsed.width) });
      sampled += 1;
    }
  }
  const rankedColors = [...colors.entries()].sort((left, right) => right[1] - left[1]);
  const [dominantKey, dominant = 0] = rankedColors[0] ?? [null, 0];
  const nonDominantSamples = dominantKey === null ? [] : samples.filter(sample => sample.key !== dominantKey);
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
    dominantSampledColor: dominantKey === null ? null : colorSummary(dominantKey, dominant, sampled),
    topSampledColors: rankedColors.slice(0, 4).map(([key, count]) => colorSummary(key, count, sampled)),
    nonDominantSampledPixels: nonDominantSamples.length,
    nonDominantBounds: sampleBounds(nonDominantSamples),
    nonDominantQuadrants: sampleQuadrants(nonDominantSamples, parsed.width, parsed.height),
  };
}

function colorSummary(key, count, sampled) {
  return {
    rgb: key.split(',').map(Number),
    count,
    ratio: sampled > 0 ? Number((count / sampled).toFixed(4)) : 0,
  };
}

function sampleBounds(samples) {
  if (samples.length === 0) return null;
  return samples.reduce((bounds, sample) => ({
    minX: Math.min(bounds.minX, sample.x),
    minY: Math.min(bounds.minY, sample.y),
    maxX: Math.max(bounds.maxX, sample.x),
    maxY: Math.max(bounds.maxY, sample.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
}

function sampleQuadrants(samples, width, height) {
  const counts = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
  for (const sample of samples) {
    const vertical = sample.y < height / 2 ? 'top' : 'bottom';
    const horizontal = sample.x < width / 2 ? 'Left' : 'Right';
    counts[`${vertical}${horizontal}`] += 1;
  }
  return counts;
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

function graphicalPpmExpectation() {
  return {
    minimumWidth: 640,
    minimumHeight: 480,
    minimumUniqueSampledColors: 6,
    minimumNonDominantRatio: 0.02,
  };
}

function sourceMatches(sources, pattern) {
  const matches = [];
  for (const source of sources) {
    source.text.split(/\r?\n/u).forEach((line, index) => {
      if (pattern.test(line)) matches.push({ path: source.rel, line: index + 1, text: line.trim() });
    });
  }
  return matches;
}

function addColor(colors, red, green, blue) {
  const key = `${red},${green},${blue}`;
  colors.set(key, (colors.get(key) || 0) + 1);
  return key;
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

function check(checks, id, ok, details, expected) {
  checks.push({ id, ok: Boolean(ok), ...(expected ? { expected } : {}), details });
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
