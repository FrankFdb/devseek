import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const protectedWorkspacePaths = Object.freeze([
  'CMakeLists.txt',
  'test.sh',
  'devseek.verify.json',
  'USER_STORY.md',
  'tools/verify-ppm.mjs',
  'assets/fraction-number-line.actions',
  'assets/quiz.actions',
  'assets/invalid.actions',
]);

export function prepareWorkspace(workspace) {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'assets'), { recursive: true });
  write(path.join(workspace, '.vscode/settings.json'), `${JSON.stringify({
    'devseek.protectedFiles': [
      'CMakeLists.txt',
      'test.sh',
      'devseek.verify.json',
      'USER_STORY.md',
      'tools/verify-ppm.mjs',
      'assets/**',
    ],
  }, null, 2)}\n`);
  write(path.join(workspace, 'CMakeLists.txt'), cmakeContract());
  write(path.join(workspace, 'test.sh'), testContract(), 0o755);
  write(path.join(workspace, 'devseek.verify.json'), JSON.stringify(verificationContract(), null, 2));
  write(path.join(workspace, 'USER_STORY.md'), userStory());
  write(path.join(workspace, 'assets/fraction-number-line.actions'), [
    'lesson fractions',
    'set-total 4',
    'set-selected 3',
    'lesson number-line',
    'move-marker 6',
  ].join('\n'));
  write(path.join(workspace, 'assets/quiz.actions'), [
    'lesson quiz',
    'answer 7',
    'submit',
    'next-question',
    'answer 5',
    'submit',
  ].join('\n'));
  write(path.join(workspace, 'assets/invalid.actions'), 'set-total 0\n');
  installWorkspaceVerificationTools(workspace);
  const gitInit = cp.spawnSync('git', ['init', '--quiet'], { cwd: workspace, encoding: 'utf8' });
  if (gitInit.status !== 0) throw new Error(`Could not initialize isolated fixture repository: ${gitInit.stderr || gitInit.stdout}`);
}

export function installWorkspaceVerificationTools(workspace) {
  const source = fs.readFileSync(path.join(here, 'ppm-analysis.mjs'), 'utf8');
  write(path.join(workspace, 'tools/verify-ppm.mjs'), source);
  write(path.join(workspace, 'devseek.verify.json'), JSON.stringify(verificationContract(), null, 2));
}

function verificationContract() {
  return {
    commands: [
      {
        id: 'public',
        cmd: 'bash',
        args: ['test.sh'],
        paths: ['src', 'include', 'CMakeLists.txt', 'test.sh'],
      },
      {
        id: 'wide-render',
        cmd: 'bash',
        args: ['-lc', './build/math_visual_lab --script assets/fraction-number-line.actions --snapshot verification-wide.ppm --state verification-wide.json --width 1024 --height 640 && node tools/verify-ppm.mjs verification-wide.ppm'],
        paths: [
          'src/main.cpp',
          'src/math_model.cpp',
          'src/lesson_controller.cpp',
          'src/raster_canvas.cpp',
          'include/math_model.hpp',
          'include/lesson_controller.hpp',
          'include/raster_canvas.hpp',
        ],
        dependsOn: ['public'],
      },
      {
        id: 'x11-smoke',
        cmd: 'bash',
        args: ['-lc', 'DISPLAY=${DISPLAY:-:0} ./build/math_visual_lab --smoke-frames 3 --width 800 --height 600'],
        paths: ['src/x11_app.cpp', 'include/x11_app.hpp'],
        dependsOn: ['public'],
      },
      {
        id: 'x11-sanitizer',
        cmd: 'bash',
        args: ['-lc', 'cmake -S . -B build-sanitizer -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer" -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=address,undefined" && cmake --build build-sanitizer --parallel 2 && ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 DISPLAY=${DISPLAY:-:0} ./build-sanitizer/math_visual_lab --smoke-frames 3 --width 800 --height 600'],
        paths: ['src/x11_app.cpp', 'include/x11_app.hpp'],
      },
      {
        id: 'operator-readme',
        cmd: 'node',
        args: ['-e', 'const s=require("fs").readFileSync("README.md","utf8");if(!/(build|cmake)/i.test(s)||!/(keyboard|mouse|键盘|鼠标)/i.test(s)||!/--smoke-frames/.test(s))process.exit(1)'],
        paths: ['README.md'],
      },
    ],
  };
}

function cmakeContract() {
  return `cmake_minimum_required(VERSION 3.16)
project(math_visual_lab LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(X11 REQUIRED)

add_executable(math_visual_lab
  src/main.cpp
  src/math_model.cpp
  src/lesson_controller.cpp
  src/raster_canvas.cpp
  src/x11_app.cpp
)

target_include_directories(math_visual_lab PRIVATE include \${X11_INCLUDE_DIR})
target_link_libraries(math_visual_lab PRIVATE \${X11_LIBRARIES})
target_compile_options(math_visual_lab PRIVATE -Wall -Wextra -Wpedantic -Werror)
`;
}

function testContract() {
  return String.raw`#!/usr/bin/env bash
set -euo pipefail
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 2
./build/math_visual_lab --self-test
`;
}

function userStory() {
  return String.raw`# Math Visual Lab User Story

Build a C++17 graphical learning program for primary-school fractions, a number
line, and a two-question arithmetic quiz. Production code is split by semantic
owner across these fixed files:

- include/math_model.hpp and src/math_model.cpp
- include/lesson_controller.hpp and src/lesson_controller.cpp
- include/raster_canvas.hpp and src/raster_canvas.cpp
- include/x11_app.hpp and src/x11_app.cpp
- src/main.cpp

The X11 adapter owns only the native window and event translation. The lesson
controller owns all user actions and state transitions. The same raster renderer
must serve the live window and deterministic PPM snapshots.

## Deterministic interface

The final command contract is:

    math_visual_lab --self-test
    math_visual_lab --script ACTIONS --snapshot OUTPUT.ppm --state OUTPUT.json [--width 800 --height 600]
    math_visual_lab --smoke-frames 3 [--width 800 --height 600]
    node tools/verify-ppm.mjs OUTPUT.ppm

Actions are one per line:

- lesson fractions|number-line|quiz
- set-total N
- set-selected N
- move-marker N
- answer N
- submit
- next-question

State JSON contains lesson, handledActions, fraction.selected, fraction.total,
numberLine.marker, and quiz.answered, quiz.correct, quiz.feedback. handledActions
is the integer count of accepted actions. quiz.answered and quiz.correct are the
integer counts of submitted and correct answers across the current quiz session;
quiz.feedback is the latest non-empty learner-facing result after submission.
PPM output is at least 640x480 and contains the complete rendered UI, not a
placeholder image.

Quiz questions are deterministic: 3+4 and 8-3. Bounds are total 1..12,
selected 0..total, and marker -10..10. Unknown actions and invalid values return
a non-zero exit code with a readable diagnostic.

Do not modify CMakeLists.txt, test.sh, USER_STORY.md, tools/verify-ppm.mjs, or assets/. Do not bypass
the X11 smoke path, duplicate controller behavior for tests, invoke shell commands
from production code, or leave TODO/FIXME placeholders.
`;
}

function write(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.trimEnd()}\n`, 'utf8');
  if (mode) fs.chmodSync(filePath, mode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspace = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'runs/manual/workspace');
  prepareWorkspace(workspace);
  console.log(JSON.stringify({ ok: true, workspace, protectedWorkspacePaths }, null, 2));
}
