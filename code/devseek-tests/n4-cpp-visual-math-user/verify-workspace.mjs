import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  graphicalPpmExpectation,
  ppmLooksGraphical,
  readPpmStats,
} from './ppm-analysis.mjs';

export { ppmLooksGraphical, readPpmStats };

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

const verificationCheckIds = Object.freeze([
  'source-contract',
  'source-hygiene',
  'interaction-dispatch-acyclic',
  'script-render-shares-controller',
  'public-build-and-self-test',
  'fraction-number-line-command',
  'fraction-number-line-state',
  'fraction-number-line-pixels',
  'quiz-command',
  'quiz-state',
  'quiz-pixels',
  'compact-render-command',
  'compact-render-size',
  'compact-render-pixels',
  'wide-render-command',
  'wide-render-size',
  'wide-render-pixels',
  'invalid-action-rejected',
  'real-x11-window-smoke',
  'sanitizer-configure',
  'sanitizer-build',
  'sanitizer-x11-repeated-frame',
  'operator-readme',
]);

export function verifyWorkspace(workspace, stage, evidenceDir, options = {}) {
  const checks = [];
  const artifacts = {};
  const root = path.resolve(workspace);
  const evidence = path.resolve(evidenceDir);
  const selected = selectVerificationChecks(options.checkIds);
  const wants = id => selected === null || selected.has(id);
  const wantsAny = ids => ids.some(wants);
  fs.mkdirSync(evidence, { recursive: true });

  if (wants('source-contract')) {
    check(checks, 'source-contract', sourcePaths.every(rel => fileHasContent(root, rel)), {
      missing: sourcePaths.filter(rel => !fileHasContent(root, rel)),
    });
  }
  const existingSources = sourcePaths
    .filter(rel => fileHasContent(root, rel))
    .map(rel => ({ rel, text: fs.readFileSync(path.join(root, rel), 'utf8') }));
  const sourceText = existingSources.map(source => source.text).join('\n');
  const unfinishedImplementation = hasUnfinishedImplementation(sourceText);
  const unfinishedMatches = sourceMatches(existingSources, unfinishedSource);
  const systemCallMatches = sourceMatches(existingSources, /\bsystem\s*\(/u);
  if (wants('source-hygiene')) {
    check(checks, 'source-hygiene', !unfinishedImplementation && !/\bsystem\s*\(/u.test(sourceText), {
      unfinishedImplementation,
      systemCall: /\bsystem\s*\(/u.test(sourceText),
      unfinishedMatches,
      systemCallMatches,
    }, {
      unfinishedImplementation: false,
      systemCall: false,
    });
  }

  if (stage >= 2) {
    const lessonControllerSource = existingSources.find(source => source.rel === 'src/lesson_controller.cpp')?.text ?? '';
    const interactionCycles = findInteractionDispatcherCycles(lessonControllerSource);
    if (wants('interaction-dispatch-acyclic')) {
      check(checks, 'interaction-dispatch-acyclic', interactionCycles.length === 0, {
        cycles: interactionCycles,
      }, {
        cycles: [],
      });
    }

    const mainSource = existingSources.find(source => source.rel === 'src/main.cpp')?.text ?? '';
    const scriptRenderOwnership = inspectScriptRenderOwnership(mainSource);
    if (wants('script-render-shares-controller')) {
      check(checks, 'script-render-shares-controller', scriptRenderOwnership.functionFound
        && scriptRenderOwnership.delegatesToLessonController
        && scriptRenderOwnership.directLessonRendererCalls.length === 0, {
        semanticOwner: 'src/main.cpp::runScript',
        requiredFlow: 'runScript -> LessonController::render(canvas) -> RasterCanvas lesson renderer',
        forbiddenStrategy: 'Do not inline lesson drawing in runScript or remove the RasterCanvas calls owned by LessonController::render.',
        ...scriptRenderOwnership,
      }, {
        functionFound: true,
        delegatesToLessonController: true,
        directLessonRendererCalls: [],
      });
    }
  }

  const runtimeCheckIds = verificationCheckIds.filter(id => (
    id.includes('-command')
      || id.includes('-state')
      || id.includes('-pixels')
      || id.includes('-size')
      || id === 'invalid-action-rejected'
      || id === 'real-x11-window-smoke'
  ));
  let buildReady = true;
  if (wants('public-build-and-self-test')) {
    const publicTest = run('./test.sh', [], root, 180_000);
    artifacts.publicTest = recordCommand(evidence, 'public-test', publicTest);
    check(checks, 'public-build-and-self-test', publicTest.status === 0, commandSummary(publicTest));
    buildReady = publicTest.status === 0;
  } else if (selected !== null && wantsAny(runtimeCheckIds)) {
    const incrementalBuild = runIncrementalBuild(root, evidence);
    artifacts.incrementalBuild = incrementalBuild.artifacts;
    buildReady = incrementalBuild.configure.status === 0 && incrementalBuild.build?.status === 0;
    if (!buildReady) {
      check(checks, 'incremental-build-prerequisite', false, {
        configure: commandSummary(incrementalBuild.configure),
        build: commandSummary(incrementalBuild.build),
      });
    }
  }

  if (stage >= 2 && buildReady && wantsAny([
    'fraction-number-line-command', 'fraction-number-line-state', 'fraction-number-line-pixels',
  ])) {
    const result = runVisualCase(root, evidence, 'fraction-number-line', 'assets/fraction-number-line.actions', 800, 600);
    artifacts.fractionNumberLine = result.artifacts;
    if (wants('fraction-number-line-command')) check(checks, 'fraction-number-line-command', result.command.status === 0, commandSummary(result.command));
    if (wants('fraction-number-line-state')) check(checks, 'fraction-number-line-state', result.state?.lesson === 'number-line'
      && result.state?.fraction?.total === 4
      && result.state?.fraction?.selected === 3
      && result.state?.numberLine?.marker === 6
      && Number(result.state?.handledActions) >= 5, result.state, {
      lesson: 'number-line',
      handledActions: { minimum: 5 },
      fraction: { selected: 3, total: 4 },
      numberLine: { marker: 6 },
    });
    if (wants('fraction-number-line-pixels')) check(checks, 'fraction-number-line-pixels', ppmLooksGraphical(result.ppm), visualCaseDetails(result), graphicalPpmExpectation());
  }

  if (stage >= 3 && buildReady && wantsAny(['quiz-command', 'quiz-state', 'quiz-pixels'])) {
    const result = runVisualCase(root, evidence, 'quiz', 'assets/quiz.actions', 800, 600);
    artifacts.quiz = result.artifacts;
    if (wants('quiz-command')) check(checks, 'quiz-command', result.command.status === 0, commandSummary(result.command));
    if (wants('quiz-state')) check(checks, 'quiz-state', result.state?.lesson === 'quiz'
      && result.state?.quiz?.answered === 2
      && result.state?.quiz?.correct === 2
      && typeof result.state?.quiz?.feedback === 'string'
      && result.state.quiz.feedback.trim().length > 0, result.state, {
      lesson: 'quiz',
      quiz: { answered: 2, correct: 2, feedback: { nonEmptyString: true } },
    });
    if (wants('quiz-pixels')) check(checks, 'quiz-pixels', ppmLooksGraphical(result.ppm), visualCaseDetails(result), graphicalPpmExpectation());
  }

  if (stage >= 4 && buildReady) {
    for (const [name, width, height] of [['compact', 640, 480], ['wide', 1024, 640]]) {
      const groupIds = [`${name}-render-command`, `${name}-render-size`, `${name}-render-pixels`];
      if (!wantsAny(groupIds)) continue;
      const result = runVisualCase(root, evidence, name, 'assets/fraction-number-line.actions', width, height);
      artifacts[name] = result.artifacts;
      if (wants(groupIds[0])) check(checks, groupIds[0], result.command.status === 0, commandSummary(result.command));
      if (wants(groupIds[1])) check(checks, groupIds[1], result.ppm?.width === width && result.ppm?.height === height, result.ppm);
      if (wants(groupIds[2])) check(checks, groupIds[2], ppmLooksGraphical(result.ppm), visualCaseDetails(result), graphicalPpmExpectation());
    }

    if (wants('invalid-action-rejected')) {
      const invalid = run(path.join(root, 'build/math_visual_lab'), [
        '--script', path.join(root, 'assets/invalid.actions'),
        '--snapshot', path.join(evidence, 'invalid.ppm'),
        '--state', path.join(evidence, 'invalid.json'),
      ], root, 30_000);
      artifacts.invalid = recordCommand(evidence, 'invalid-actions', invalid);
      check(checks, 'invalid-action-rejected', invalid.status !== 0 && /(?:invalid|range|total|1\.\.12)/iu.test(`${invalid.stdout}\n${invalid.stderr}`), commandSummary(invalid));
    }

    if (wants('real-x11-window-smoke')) {
      const smoke = run(path.join(root, 'build/math_visual_lab'), [
        '--smoke-frames', '3', '--width', '800', '--height', '600',
      ], root, 30_000, { DISPLAY: process.env.DISPLAY || ':0' });
      artifacts.x11Smoke = recordCommand(evidence, 'x11-smoke', smoke);
      check(checks, 'real-x11-window-smoke', smoke.status === 0, commandSummary(smoke));
    }
  }

  if (stage >= 4 && wantsAny(['sanitizer-configure', 'sanitizer-build', 'sanitizer-x11-repeated-frame'])) {
    const sanitizer = runSanitizerSmoke(root, evidence);
    artifacts.sanitizer = sanitizer.artifacts;
    if (wants('sanitizer-configure')) check(checks, 'sanitizer-configure', sanitizer.configure.status === 0, commandSummary(sanitizer.configure));
    if (wants('sanitizer-build')) check(checks, 'sanitizer-build', sanitizer.build?.status === 0, commandSummary(sanitizer.build));
    if (wants('sanitizer-x11-repeated-frame')) check(checks, 'sanitizer-x11-repeated-frame', sanitizer.smoke?.status === 0, commandSummary(sanitizer.smoke));
  }

  if (stage >= 4 && wants('operator-readme')) {
    const readme = fileText(root, 'README.md');
    check(checks, 'operator-readme', /(?:build|cmake)/iu.test(readme)
      && /(?:keyboard|mouse|键盘|鼠标)/iu.test(readme)
      && /--smoke-frames/u.test(readme), { bytes: Buffer.byteLength(readme) });
  }

  if (checks.length === 0) throw new Error('Selected verification checks are not available at this stage.');

  const report = {
    schemaVersion: 'devseek.n4-cpp-visual-math-verification/v1',
    workspace: root,
    stage,
    mode: selected === null ? 'full' : 'targeted',
    requestedChecks: selected === null ? verificationCheckIdsForStage(stage) : [...selected],
    ok: checks.every(item => item.ok),
    checks,
    artifacts,
    verifiedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(evidence, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function selectVerificationChecks(checkIds) {
  if (checkIds === undefined || checkIds === null) return null;
  if (!Array.isArray(checkIds) || checkIds.length === 0) {
    throw new Error('checkIds must be a non-empty array when targeted verification is requested.');
  }
  const selected = new Set(checkIds.map(value => String(value || '').trim()).filter(Boolean));
  const unknown = [...selected].filter(id => !verificationCheckIds.includes(id));
  if (unknown.length > 0) throw new Error(`Unknown verification checks: ${unknown.join(', ')}`);
  return selected;
}

export function verificationCheckIdsForStage(stage) {
  if (stage === 1) return verificationCheckIds.slice(0, 5);
  if (stage === 2) return verificationCheckIds.slice(0, 11 - 3);
  if (stage === 3) return verificationCheckIds.slice(0, 11);
  return [...verificationCheckIds];
}

function runIncrementalBuild(root, evidence) {
  const configure = run('cmake', [
    '-S', '.', '-B', 'build', '-DCMAKE_BUILD_TYPE=Release',
  ], root, 60_000);
  const artifacts = {
    configure: recordCommand(evidence, 'incremental-configure', configure),
  };
  if (configure.status !== 0) return { configure, artifacts };
  const build = run('cmake', ['--build', 'build', '--parallel', '2'], root, 180_000);
  artifacts.build = recordCommand(evidence, 'incremental-build', build);
  return { configure, build, artifacts };
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
      acceptanceCommand: `node tools/verify-ppm.mjs verification-${name}.ppm`,
      artifactPolicy: 'Generate diagnostic outputs inside the selected workspace. Evidence artifact paths outside it are read-only and are not tool-authorized.',
    },
    artifacts: { snapshot, statePath, commandLog },
  };
}

function visualCaseDetails(result) {
  const stats = result.ppm;
  return {
    reproduction: result.reproduction,
    renderedState: result.state ?? null,
    renderContract: {
      semanticOwner: 'LessonController::render',
      executionPath: 'runScript -> LessonController::render -> RasterCanvas lesson renderer',
      activeLesson: result.state?.lesson ?? null,
      activeRenderer: activeLessonRenderer(result.state?.lesson),
    },
    ppm: stats ? {
      width: stats.width,
      height: stats.height,
      sampledPixels: stats.sampledPixels,
      uniqueSampledColors: stats.uniqueSampledColors,
      nonDominantRatio: stats.nonDominantRatio,
      nonDominantSampledPixels: stats.nonDominantSampledPixels,
      topHalfNonDominantSampledPixels: stats.topHalfNonDominantSampledPixels,
      bottomHalfNonDominantSampledPixels: stats.bottomHalfNonDominantSampledPixels,
      nonDominantBounds: stats.nonDominantBounds,
      nonDominantQuadrants: stats.nonDominantQuadrants,
      topSampledColors: stats.topSampledColors,
    } : null,
  };
}

function activeLessonRenderer(lesson) {
  return {
    fractions: 'RasterCanvas::renderFraction',
    'number-line': 'RasterCanvas::renderNumberLine',
    quiz: 'RasterCanvas::renderQuiz',
  }[lesson] ?? null;
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
  const checksArg = process.argv.find(value => value.startsWith('--checks='));
  const checkIds = checksArg
    ? checksArg.slice('--checks='.length).split(',').map(value => value.trim()).filter(Boolean)
    : undefined;
  if (!workspace || !Number.isInteger(stage) || stage < 1 || stage > 4) {
    throw new Error('Usage: node verify-workspace.mjs <workspace> <stage 1..4> [evidence-dir] [--checks=id,id]');
  }
  const report = verifyWorkspace(workspace, stage, evidence, { checkIds });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
