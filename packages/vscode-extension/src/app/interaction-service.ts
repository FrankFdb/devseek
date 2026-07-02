import type { ChatIntentDecision } from '../intent-router';
import type { WorkflowSelection } from './workflow-service';
import { createWorkspaceFilePathTokenRegExp } from '../workspace/path-patterns';

export type UserInteractionKind = 'clarify' | 'confirm' | 'planReview';
export type UserInteractionOptionId = 'continue' | 'plan' | 'clarify';

export interface UserInteractionOption {
  id: UserInteractionOptionId;
  label: string;
  description: string;
  intentConfirmed?: boolean;
  prompt?: string;
  forceNoAgent?: boolean;
}

export interface UserInteractionRequest {
  id: string;
  kind: UserInteractionKind;
  title: string;
  body: string;
  details: string[];
  options: UserInteractionOption[];
}

export interface PreExecutionInteractionInput {
  userText: string;
  prompt: string;
  files: string[];
  intent: ChatIntentDecision;
  workflow: WorkflowSelection;
  intentConfirmed?: boolean;
}

const EXPLICIT_PATH_RE = createWorkspaceFilePathTokenRegExp('i');
const DIRECTORY_RE = /(?:^|[\s，,。；;：:])(?:[A-Za-z0-9_.-]+\/){1,}[A-Za-z0-9_.-]*(?:目录|文件夹|folder|dir)?/i;
const TECH_OR_DOMAIN_RE = /(three\.?js|react|vue|svelte|angular|node|express|next\.?js|nuxt|python|java|go|rust|c\+\+|cpp|c语言|html|css|javascript|typescript|ts|js|openGL|glut|webgl|three|3d|三维|二维|游戏|登录|注册|todo|博客|商城|后台|管理|爬虫|接口|api|数据库|可视化|图表|动画|鼠标|键盘|上传|下载|支付|聊天|地图|表格|表单|测试|命令行|cli)/i;

const VAGUE_CREATE_RE = /^(?:请|帮我|给我|麻烦)?\s*(?:写|写一个|写个|编写|创建|新建|生成|做|做个|开发|实现)\s*(?:一个|个|一下|下)?\s*(?:程序|项目|应用|app|代码|功能|脚本|页面|网站|demo|示例)?\s*[。.!！?？]*$/i;
const VAGUE_CHANGE_RE = /^(?:请|帮我|给我|麻烦)?\s*(?:修复|修一下|改一下|优化|完善|重构|排查|处理|解决)\s*(?:这个|一下|下)?\s*(?:代码|bug|问题|项目|程序)?\s*[。.!！?？]*$/i;
const VAGUE_RUN_RE = /^(?:请|帮我|给我|麻烦)?\s*(?:运行|执行|编译|构建|测试|验证|启动|调试|跑一下|跑)\s*(?:一下|下|这个|项目|程序|代码)?\s*[。.!！?？]*$/i;

export function buildPreExecutionInteraction(input: PreExecutionInteractionInput): UserInteractionRequest | null {
  if (input.intentConfirmed) return null;

  const userText = normalizeText(input.userText || input.prompt);
  if (!userText) return null;

  if (input.workflow.kind === 'confirmation-required') {
    return {
      id: makeInteractionId('confirm', userText),
      kind: 'confirm',
      title: '需要确认后再执行',
      body: '这个请求可能会删除、覆盖或重置文件。为避免误操作，请先确认是否继续。',
      details: [
        `识别到的模式：${input.intent.mode}`,
        `原因：${input.intent.reason}`,
        '继续后仍会对写文件、终端命令等高风险动作逐项要求确认。',
      ],
      options: [
        {
          id: 'continue',
          label: '确认继续',
          description: '按原请求继续执行，保留后续工具确认。',
          intentConfirmed: true,
        },
        {
          id: 'plan',
          label: '先给计划',
          description: '只生成执行计划，不修改文件。',
          prompt: buildPlanPrompt(input.prompt),
          forceNoAgent: true,
          intentConfirmed: true,
        },
        {
          id: 'clarify',
          label: '我来补充',
          description: '回到输入框补充范围、文件或安全边界。',
        },
      ],
    };
  }

  if (input.workflow.requiresPlanReview) {
    return {
      id: makeInteractionId('plan-review', userText),
      kind: 'planReview',
      title: '需要先审查计划',
      body: '这个请求涉及较大范围的重构。DevSeek 会先按计划模式处理，确认方向后再进入修改。',
      details: [
        `工作流状态：${input.workflow.state}`,
        `权限模式：${input.workflow.toolPolicyMode}`,
        `原因：${input.workflow.reason}`,
      ],
      options: [
        {
          id: 'plan',
          label: '先给计划',
          description: '只生成计划，不修改文件或执行命令。',
          prompt: buildPlanPrompt(input.prompt),
          forceNoAgent: true,
          intentConfirmed: true,
        },
        {
          id: 'continue',
          label: '确认修改',
          description: '确认计划审查要求，进入后续修改流程。',
          intentConfirmed: true,
        },
        {
          id: 'clarify',
          label: '我来补充',
          description: '补充范围、约束或验收标准后再执行。',
        },
      ],
    };
  }

  if (isAmbiguousExecutionRequest(userText, input.files, input.intent)) {
    return {
      id: makeInteractionId('clarify', userText),
      kind: 'clarify',
      title: '需要先确认执行方向',
      body: '我还不能可靠判断要做成什么程序、改哪些文件，或验证到什么程度。请先选择下一步。',
      details: buildAmbiguityDetails(userText, input.intent),
      options: [
        {
          id: 'clarify',
          label: '我来补充',
          description: '补充程序类型、技术栈、目标文件或预期效果后再执行。',
        },
        {
          id: 'plan',
          label: '先给计划',
          description: '让 DevSeek 先列出计划和需要确认的问题。',
          prompt: buildPlanPrompt(input.prompt),
          forceNoAgent: true,
          intentConfirmed: true,
        },
        {
          id: 'continue',
          label: '按默认继续',
          description: '让 Agent 自行探索工作区并选择合理默认方案。',
          intentConfirmed: true,
        },
      ],
    };
  }

  return null;
}

function isAmbiguousExecutionRequest(text: string, files: string[], intent: ChatIntentDecision): boolean {
  if (!['edit', 'run'].includes(intent.mode)) return false;
  if (files.length > 0) return false;
  if (EXPLICIT_PATH_RE.test(text) || DIRECTORY_RE.test(text)) return false;
  if (TECH_OR_DOMAIN_RE.test(text)) return false;
  if (intent.signals.includes('explicit-file-path')) return false;

  if (intent.mode === 'edit') {
    return VAGUE_CREATE_RE.test(text) || VAGUE_CHANGE_RE.test(text);
  }

  if (intent.mode === 'run') {
    return VAGUE_RUN_RE.test(text);
  }

  return false;
}

function buildAmbiguityDetails(text: string, intent: ChatIntentDecision): string[] {
  const details = [
    `识别到的意图：${intent.mode}`,
    `置信度：${Math.round(intent.confidence * 100)}%`,
  ];
  if (!EXPLICIT_PATH_RE.test(text) && !DIRECTORY_RE.test(text)) {
    details.push('没有明确文件、目录或工作范围。');
  }
  if (!TECH_OR_DOMAIN_RE.test(text)) {
    details.push('没有明确程序类型、技术栈或验收标准。');
  }
  return details;
}

function buildPlanPrompt(prompt: string): string {
  return [
    '先不要修改文件、不要执行命令、不要输出可直接应用的完整文件内容。',
    '请像 Claude Code / Codex 的计划模式一样先给出有主见的推荐方案：优先说明推荐默认边界和执行步骤，而不是把每个决策都交给用户选择。',
    '如果确实存在会改变架构边界、兼容性或安全策略的阻塞分歧，最多列 3 个需要确认的问题；每个问题都必须给出“推荐默认”与简短理由。',
    '不要输出大量 A/B/C 问卷。没有阻塞问题时，写“无阻塞，建议按推荐默认继续”。',
    '',
    '输出结构：',
    '1. 目标理解',
    '2. 推荐默认边界',
    '3. 实施计划',
    '4. 需要确认的问题（可选，最多 3 项）',
    '',
    prompt,
  ].join('\n');
}

function normalizeText(value: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function makeInteractionId(prefix: string, text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`;
}
