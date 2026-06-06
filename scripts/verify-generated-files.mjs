import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = mkdtempSync(path.join(tmpdir(), 'deepseek-artifacts-'));
const localRequire = createRequire(import.meta.url);

const fixtureCases = [
  {
    name: 'json-actions-create-with-workspace-absolute-tilde-path',
    requestPrompt: '请在打开的vscode的~/work/deepseek_netai/code/目录下创建hello.cpp程序，编写C++程序打印deepseek good！',
    responseText: [
      '{',
      '  "actions": [',
      '    {',
      '      "type": "create",',
      '      "path": "~/work/deepseek_netai/code/hello.cpp",',
      '      "content": "#include <iostream>\\n\\nint main() {\\n    std::cout << \\"deepseek good!\\" << std::endl;\\n    return 0;\\n}\\n"',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
    expectResolved: [
      {
        path: '~/work/deepseek_netai/code/hello.cpp',
        contains: 'deepseek good!',
        excludes: [],
      },
    ],
  },
  {
    name: 'create-file-with-shell-instructions',
    requestPrompt: '在 code 目录下创建一个 helloworld.cpp，输出完整代码',
    responseText: [
      '在 code 目录下创建 helloworld.cpp，输出完整代码',
      '',
      '以下是在 code 目录下创建 helloworld.cpp 的完整代码：',
      '',
      '```cpp',
      '#include <iostream>',
      '',
      'int main() {',
      '    std::cout << "Hello, World!" << std::endl;',
      '    return 0;',
      '}',
      '```',
      '',
      '使用说明：',
      '',
      '编译运行：',
      '',
      '```',
      'g++ code/helloworld.cpp -o code/helloworld',
      './code/helloworld',
      '```',
    ].join('\n'),
    expectResolved: [
      {
        path: 'code/helloworld.cpp',
        contains: '#include <iostream>',
        excludes: ['g++ code/helloworld.cpp', './code/helloworld'],
      },
    ],
  },
  {
    name: 'modify-file-with-unified-diff',
    requestPrompt: '修改 code/helloworld.cpp，增加一行输出',
    responseText: [
      '```diff',
      '--- a/code/helloworld.cpp',
      '+++ b/code/helloworld.cpp',
      '@@ -1,5 +1,6 @@',
      ' #include <iostream>',
      ' ',
      ' int main() {',
      '-    std::cout << "Hello, World!" << std::endl;',
      '+    std::cout << "Hello, World!" << std::endl;',
      '+    std::cout << "DeepSeek" << std::endl;',
      '     return 0;',
      ' }',
      '```',
    ].join('\n'),
    expectPatch: 'code/helloworld.cpp',
  },
  {
    name: 'ignore-explain-mode-code-block',
    requestPrompt: '这个函数为什么慢？请解释原因',
    responseText: [
      '可能原因如下：',
      '',
      '```cpp',
      'for (int i = 0; i < n; ++i) {',
      '    for (int j = 0; j < n; ++j) {',
      '        sum += a[i][j];',
      '    }',
      '}',
      '```',
    ].join('\n'),
    expectResolved: [],
  },
  {
    name: 'ignore-explain-mode-even-with-file-heading',
    requestPrompt: '解释代码 Addition.cpp 这段实现的作用',
    responseText: [
      '### Addition.cpp',
      '```cpp',
      'double Addition::calculate(double a, double b) {',
      '    return a + b;',
      '}',
      '```',
      '',
      '这段代码用于返回两个参数的和。',
    ].join('\n'),
    expectResolved: [],
  },
  {
    name: 'directory-scoped-helloworld-request-should-trigger-change-mode',
    requestPrompt: 'code目录下编译一个helloworld程序，C++语言',
    responseText: [
      '好的，这是一个解释和分析任务，我会直接说明如何在 code 目录下编译一个 C++ 的 HelloWorld 程序。',
      '',
      '步骤说明',
      '创建源代码文件在 code 目录下新建一个 hello.cpp 文件，内容如下：',
      '```cpp',
      '#include <iostream>',
      'int main() {',
      '    std::cout << "Hello, world!" << std::endl;',
      '    return 0;',
      '}',
      '```',
      '',
      '编译使用常见的 C++ 编译器（如 g++）进行编译。假设当前路径就在 code 目录下，执行：',
      '```',
      'g++ hello.cpp -o hello',
      '```',
    ].join('\n'),
    expectResolved: [
      {
        path: 'code/hello.cpp',
        contains: 'Hello, world!',
        excludes: ['g++ hello.cpp -o hello'],
      },
    ],
  },
  {
    name: 'allow-ambiguous-followup-when-response-is-strongly-structured',
    requestPrompt: '继续实现完整项目',
    responseText: [
      '文件 1：include/Operation.h - 头文件',
      '```cpp',
      '#pragma once',
      'class Operation {};',
      '```',
      '',
      '文件 2：src/Operation.cpp - 实现',
      '```cpp',
      '#include "Operation.h"',
      '```',
    ].join('\n'),
    expectResolved: [
      {
        path: 'generated-cpp-project/include/Operation.h',
        contains: 'class Operation',
        excludes: [],
      },
      {
        path: 'generated-cpp-project/src/Operation.cpp',
        contains: '#include "Operation.h"',
        excludes: [],
      },
    ],
  },
  {
    name: 'multi-file-tree-with-numbered-headings',
    requestPrompt: '在 code 目录下创建一个 calculator 多文件 C++ 项目',
    responseText: [
      'calculator/',
      '├── addition.h',
      '├── addition.cpp',
      '└── main.cpp',
      '',
      '1. addition.h - 头文件',
      '```cpp',
      '#pragma once',
      'int add(int a, int b);',
      '```',
      '',
      '2. addition.cpp - 实现',
      '```cpp',
      '#include "addition.h"',
      'int add(int a, int b) { return a + b; }',
      '```',
      '',
      '3. main.cpp - 入口',
      '```cpp',
      '#include <iostream>',
      '#include "addition.h"',
      'int main() { std::cout << add(2, 3) << std::endl; return 0; }',
      '```',
    ].join('\n'),
    expectResolved: [
      {
        path: 'calculator/addition.h',
        contains: 'int add(int a, int b);',
        excludes: [],
      },
      {
        path: 'calculator/addition.cpp',
        contains: 'return a + b;',
        excludes: [],
      },
      {
        path: 'calculator/main.cpp',
        contains: 'std::cout << add(2, 3)',
        excludes: [],
      },
    ],
  },
  {
    name: 'bold-filename-heading-with-backslash-path',
    requestPrompt: '请创建 code\\hello.py，打印 hi',
    responseText: [
      '**hello.py**',
      '```python',
      'print("hi")',
      '```',
    ].join('\n'),
    expectResolved: [
      {
        path: 'code/hello.py',
        contains: 'print("hi")',
        excludes: [],
      },
    ],
  },
  {
    name: 'project-root-wrap-for-include-src-layout',
    requestPrompt: '编写一个四则混合运算的C++程序，每种计算用一个类，独立文件实现',
    responseText: [
      '文件 1：include/Operation.h - 运算基类',
      '```cpp',
      '#pragma once',
      'class Operation { public: virtual ~Operation() = default; };',
      '```',
      '',
      '文件 2：src/main.cpp - 主程序',
      '```cpp',
      '#include "Operation.h"',
      'int main() { return 0; }',
      '```',
      '',
      '文件 13：CMakeLists.txt - CMake构建配置',
      '```cmake',
      'cmake_minimum_required(VERSION 3.10)',
      'project(Calculator)',
      'add_executable(calculator src/main.cpp)',
      '```',
      '',
      '文件 14：Makefile - Make构建配置',
      '```makefile',
      'TARGET = calculator',
      '```',
    ].join('\n'),
    expectResolved: [
      {
        path: 'calculator/include/Operation.h',
        contains: 'class Operation',
        excludes: [],
      },
      {
        path: 'calculator/src/main.cpp',
        contains: 'int main() { return 0; }',
        excludes: [],
      },
      {
        path: 'calculator/CMakeLists.txt',
        contains: 'project(Calculator)',
        excludes: [],
      },
      {
        path: 'calculator/Makefile',
        contains: 'TARGET = calculator',
        excludes: [],
      },
    ],
  },
  {
    name: 'fallback-project-root-wrap-for-generic-include-src-layout',
    requestPrompt: '编写一个多文件C++程序，每个类独立文件实现',
    responseText: [
      '文件 1：include/Worker.h - 头文件',
      '```cpp',
      '#pragma once',
      'class Worker {};',
      '```',
      '',
      '文件 2：src/Worker.cpp - 实现',
      '```cpp',
      '#include "Worker.h"',
      '```',
      '',
      '文件 3：src/main.cpp - 入口',
      '```cpp',
      '#include "Worker.h"',
      'int main() { return 0; }',
      '```',
    ].join('\n'),
    expectResolved: [
      {
        path: 'generated-cpp-project/include/Worker.h',
        contains: 'class Worker',
        excludes: [],
      },
      {
        path: 'generated-cpp-project/src/Worker.cpp',
        contains: '#include "Worker.h"',
        excludes: [],
      },
      {
        path: 'generated-cpp-project/src/main.cpp',
        contains: 'int main() { return 0; }',
        excludes: [],
      },
    ],
  },
  {
    name: 'class-hierarchy-response-with-tree-and-numbered-files',
    requestPrompt: '编写一个C++程序，体现类的层次关系，简要',
    responseText: [
      '项目结构',
      'Code/',
      '├── Shape.h        # 基类（抽象类）',
      '├── Shape.cpp',
      '├── Circle.h       # 派生类1',
      '├── Circle.cpp',
      '├── Rect.h         # 派生类2',
      '├── Rect.cpp',
      '└── main.cpp',
      '',
      '1. Shape.h - 形状基类',
      '```cpp',
      '#ifndef SHAPE_H',
      '#define SHAPE_H',
      '#include <string>',
      'class Shape {',
      'public:',
      '  virtual double getArea() const = 0;',
      '};',
      '#endif',
      '```',
      '',
      '2. Shape.cpp',
      '```cpp',
      '#include "Shape.h"',
      'double f() { return 0; }',
      '```',
      '',
      '3. Circle.h - 圆形类',
      '```cpp',
      '#ifndef CIRCLE_H',
      '#define CIRCLE_H',
      '#include "Shape.h"',
      'class Circle : public Shape {};',
      '#endif',
      '```',
      '',
      '4. Circle.cpp',
      '```cpp',
      '#include "Circle.h"',
      'double g() { return 1; }',
      '```',
      '',
      '5. Rect.h - 矩形类',
      '```cpp',
      '#ifndef RECT_H',
      '#define RECT_H',
      '#include "Shape.h"',
      'class Rect : public Shape {};',
      '#endif',
      '```',
      '',
      '6. Rect.cpp',
      '```cpp',
      '#include "Rect.h"',
      'double h() { return 2; }',
      '```',
      '',
      '7. main.cpp',
      '```cpp',
      '#include "Circle.h"',
      '#include "Rect.h"',
      'int main() { return 0; }',
      '```',
    ].join('\n'),
    expectResolved: [
      {
        path: 'Code/Shape.h',
        contains: 'class Shape',
        excludes: ['├── Shape.h'],
      },
      {
        path: 'Code/Shape.cpp',
        contains: '#include "Shape.h"',
        excludes: [],
      },
      {
        path: 'Code/Circle.h',
        contains: 'class Circle : public Shape',
        excludes: [],
      },
      {
        path: 'Code/Circle.cpp',
        contains: '#include "Circle.h"',
        excludes: [],
      },
      {
        path: 'Code/Rect.h',
        contains: 'class Rect : public Shape',
        excludes: [],
      },
      {
        path: 'Code/Rect.cpp',
        contains: '#include "Rect.h"',
        excludes: [],
      },
      {
        path: 'Code/main.cpp',
        contains: 'int main() { return 0; }',
        excludes: [],
      },
    ],
  },
];

async function bundleModule(entryPoint, outfile) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    sourcemap: false,
    plugins: [
      {
        name: 'mock-vscode',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^vscode$/ }, () => ({ path: path.join(tempDir, 'vscode-stub.cjs') }));
        },
      },
    ],
  });
}

async function loadModules() {
  writeFileSync(
    path.join(tempDir, 'vscode-stub.cjs'),
    [
      'module.exports = {',
      '  workspace: {',
      '    fs: { readDirectory: async () => [] },',
      '    getConfiguration: () => ({ get: (_key, fallback) => fallback }),',
      '    asRelativePath: (value) => typeof value === "string" ? value : (value?.fsPath || "")',
      '  },',
      '  languages: { getDiagnostics: () => [] },',
      '  DiagnosticSeverity: { Error: 0, Warning: 1 },',
      '  FileType: { Directory: 2 },',
      '};',
    ].join('\n'),
    'utf8',
  );

  const parserOut = path.join(tempDir, 'generated-file-parser.cjs');
  const resolverOut = path.join(tempDir, 'generated-file-resolver.cjs');
  await bundleModule(path.join(repoRoot, 'packages/vscode-extension/src/generated-file-parser.ts'), parserOut);
  await bundleModule(path.join(repoRoot, 'packages/vscode-extension/src/generated-file-resolver.ts'), resolverOut);

  return {
    ...localRequire(parserOut),
    ...localRequire(resolverOut),
  };
}

async function main() {
  const { parseGeneratedArtifacts, resolveGeneratedArtifacts } = await loadModules();

  for (const testCase of fixtureCases) {
    if (testCase.expectPatch) {
      const artifacts = parseGeneratedArtifacts(testCase.responseText);
      assert.equal(artifacts.length, 1, `${testCase.name}: 应识别出 1 个 artifact`);
      assert.equal(artifacts[0].type, 'patch', `${testCase.name}: 应识别为 patch`);
      assert.equal(artifacts[0].path, testCase.expectPatch, `${testCase.name}: patch 路径不正确`);
      continue;
    }

    const resolved = await resolveGeneratedArtifacts({
      responseText: testCase.responseText,
      requestPrompt: testCase.requestPrompt,
    });

    assert.equal(resolved.length, testCase.expectResolved.length, `${testCase.name}: 解析出的文件数量不符合预期`);
    for (let index = 0; index < testCase.expectResolved.length; index += 1) {
      const expected = testCase.expectResolved[index];
      const actual = resolved[index];
      assert.equal(actual.resolvedPath, expected.path, `${testCase.name}: 文件路径不正确`);
      assert.match(actual.content, new RegExp(escapeRegExp(expected.contains)), `${testCase.name}: 文件内容未命中预期代码`);
      for (const text of expected.excludes) {
        assert.doesNotMatch(actual.content, new RegExp(escapeRegExp(text)), `${testCase.name}: 文件内容错误包含说明/命令块`);
      }
    }
  }

  console.log('verify-generated-files: PASS');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

try {
  await main();
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
