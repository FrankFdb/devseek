# DeepSeek NetAI

封装 DeepSeek 网页版，提供类 GitHub Copilot 体验的免费 VS Code AI 编程助手。

## 开发治理要求

为保证插件后续持续演进时架构稳定、问题可追溯，后续所有功能开发默认遵守以下规则：

1. 默认最小修改，优先复用既有模块与接口。
2. 若现有架构无法承载新功能，可以重构，但必须先更新需求与设计，并明确边界变化。
3. 所有新增功能与行为变更，必须同步更新：
  - `docs/需求分析.md`
  - `docs/软件设计.md`
  - `docs/CHANGELOG.md`
4. 重要架构变更、高风险功能和阶段版本应在 `backups/<版本>-<日期>/` 保留可回查快照。
5. 排障优先沿“需求 -> 设计 -> 代码 -> 变更日志 -> 备份”链路定位，避免直接在现有代码上盲目试错。

---

## 🚀 快速安装（推荐，无需编译）

> 只需 Node.js + Playwright，3 步完成安装。

### 第一步：安装 VS Code 插件

直接双击 `.vsix` 文件，或命令行安装：

```bash
code --install-extension backups/v1.7-2026-04-30/devseek-netai-v1.7.vsix
```

> 或在 VS Code 中：扩展面板 → 右上角 `…` → **从 VSIX 安装**，选择上述 `.vsix` 文件。

### 第二步：安装 Bridge 依赖并首次登录

```bash
# 在项目根目录执行
npm install

# 方式 A（推荐）：使用系统已安装的 Google Chrome，无需额外下载
# 确认 Chrome 已安装：google-chrome --version  或  google-chrome-stable --version
# 无需运行 playwright install，直接跳到登录步骤

# 方式 B：下载 Playwright 内置 Chromium（Chrome 未安装时使用）
cd packages/bridge && npx playwright install chromium

# 首次登录（会打开浏览器，手动完成 DeepSeek 登录，Cookie 自动保存）
npm run login
```

> **使用 Google Chrome**：在 Bridge 启动命令前加 `USE_CHROME=true`，例如：
> ```bash
> USE_CHROME=true npm run start
> ```

### 第三步：启动 Bridge 服务

```bash
cd packages/bridge && npm run start
```

Bridge 启动后，重新加载 VS Code（`Ctrl+Shift+P` → `Developer: Reload Window`）即可使用。

> 💡 之后每次打开 VS Code，Bridge 会**自动随插件启动**，无需手动运行。

---

## 项目结构

```
deepseek_netai/
├── backups/                    # 版本备份（含可直接安装的 .vsix）
│   └── v1.7-2026-04-30/
│       └── devseek-netai-v1.7.vsix   ← 最新版本
├── docs/需求分析.md            # 完整需求文档（含可行性审计）
├── docs/软件设计.md            # Copilot 风格文件生成/修改能力的软件设计
├── docs/CHANGELOG.md           # 版本变更日志
├── packages/
│   ├── shared/                 # 共享类型定义
│   ├── bridge/                 # 本地桥接服务（Playwright + Express）
│   └── vscode-extension/       # VS Code 插件源码
└── scripts/verify-bridge.sh    # 自动化验证脚本
```

---

## 开发模式（从源码构建）

### 安装依赖

```bash
cd deepseek_netai
npm install
```

### 安装 Playwright 浏览器

```bash
cd packages/bridge
npx playwright install chromium
```

### 首次登录（保存 Cookie）

```bash
npm run login --workspace=packages/bridge
```

浏览器会自动打开 DeepSeek，手动完成登录后 Cookie 自动保存，后续无需重复登录。

### 启动 Bridge 服务

```bash
npm run bridge:dev
```

输出示例：
```
[bridge] Server listening on http://127.0.0.1:3721
[bridge] Endpoints:
  GET  http://127.0.0.1:3721/ping
  GET  http://127.0.0.1:3721/status
  POST http://127.0.0.1:3721/chat
  POST http://127.0.0.1:3721/cancel
```

---

## 验证 Bridge 服务

```bash
# 方式一：一键验证脚本
bash scripts/verify-bridge.sh

# 方式二：手动 curl 测试
# 1) ping
curl http://127.0.0.1:3721/ping
# 期望：{"ok":true,"version":"0.1.0"}

# 2) 状态查询
curl http://127.0.0.1:3721/status
# 期望：{"idle":true,"queueLength":0,"browserReady":true}

# 3) 非流式对话
curl -X POST http://127.0.0.1:3721/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"1+1等于几？请只回答数字。","stream":false,"newSession":true}'
# 期望：{"content":"2"}

# 4) 流式 SSE 对话
curl -X POST http://127.0.0.1:3721/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"用一句话介绍你自己","stream":true}' \
  --no-buffer
# 期望：逐行输出 data: {"delta":"...","done":false}
```

---

## VS Code 插件使用

### 安装并调试

1. 打开 `packages/vscode-extension` 目录（单独用 VS Code 打开）
2. 确保 Bridge 服务已在后台运行
3. 按 `F5` 启动 Extension Development Host
4. 在新窗口中打开任意代码文件

### 功能入口

| 操作 | 说明 |
|------|------|
| 右键菜单 → `DeepSeek: 解释代码` | 选中代码后右键，解释代码逻辑 |
| 右键菜单 → `DeepSeek: 修复 Bug` | 自动注入 LSP 诊断错误，获取修复方案 |
| 右键菜单 → `DeepSeek: 重构代码` | 获取重构建议 |
| 右键菜单 → `DeepSeek: 生成单元测试` | 生成测试代码 |
| 右键菜单 → `DeepSeek: 生成文档注释` | 生成 JSDoc/docstring |
| 右键菜单 → `DeepSeek: 自定义提问` | 输入任意问题 |
| `Ctrl+Shift+D` | 打开侧边栏 Chat 面板 |
| `Ctrl+Shift+A` | 快速提问（需选中代码）|

所有命令响应输出在 VS Code Output Channel `DeepSeek NetAI` 中流式显示。

---

## 配置项

在 VS Code 设置（`settings.json`）中可调整：

```json
{
  "devseek.serverPort": 3721,
  "devseek.newSessionPerRequest": false,
  "devseek.language": "zh",
  "devseek.maxContextLines": 100,
  "devseek.requestTimeoutMs": 60000
}
```

---

## 常见问题

### Bridge 无法连接 DeepSeek

- 确保浏览器窗口正常打开（有头模式）
- 检查 `~/.devseek-netai/cookies.json` 是否存在
- Cookie 过期时请重新运行：`npm run login --workspace=packages/bridge`

### 选择器失效（网页更新后）

DeepSeek 更新 UI 后，修改 `packages/bridge/src/config.ts` 中的 `SELECTORS` 对象，用 DevTools 获取最新选择器后更新即可。

### 响应被截断

在与 DeepSeek 的对话中，如果代码被截断，系统会自动追加"请继续"（Phase 3 开发中）。当前版本可手动在 Chat 面板中输入"请继续"。

---

## 开发路线

- ✅ **Iter 1 (MVP)**: Bridge 核心 — Playwright + Express, /chat /ping /status /cancel
- ✅ **Iter 2 (Stream)**: SSE 流式输出（端到端）
- ✅ **Iter 3 (Extension)**: VS Code 插件 — Chat 面板 + 6个右键命令 + 上下文感知
- 🔲 **Iter 4**: Diff 视图接受/拒绝 + 对话历史持久化 + @文件上下文
