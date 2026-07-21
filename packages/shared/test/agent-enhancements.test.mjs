import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitPrAssistantService,
  HookPlanner,
  McpPermissionService,
  SkillDiscoveryService,
  SubagentRegistry,
} from '../dist/index.js';

test('HookPlanner selects deterministic hooks and blocks sensitive writes', () => {
  const planner = new HookPlanner();
  const afterEdit = planner.plan('afterEdit', ['src/app.ts']);
  assert.deepEqual(afterEdit.hooks.map(hook => hook.id), ['format-typescript']);
  assert.deepEqual(afterEdit.blockedReasons, []);

  const beforeEdit = planner.plan('beforeEdit', ['.env']);
  assert.deepEqual(beforeEdit.hooks, []);
  assert.deepEqual(beforeEdit.blockedReasons, ['sensitive-file:.env']);
});

test('R3-07B HookPlanner creates parent-owned policy evidence and exposes failure and bypass', () => {
  const planner = new HookPlanner();
  const receipt = planner.planPolicy({
    stage: 'beforeValidate',
    changedFiles: ['src/app.ts'],
    hooks: [
      {
        id: 'quality-veto',
        stage: 'beforeValidate',
        command: 'npm test',
        fileGlobs: ['*.ts'],
        description: 'Required quality check.',
        policy: 'veto',
        effect: 'read',
        policyVersion: 'quality/v1',
      },
      {
        id: 'style-warning',
        stage: 'beforeValidate',
        command: 'npm run lint',
        fileGlobs: ['*.ts'],
        description: 'Advisory lint check.',
        policy: 'warning',
        effect: 'read',
      },
      {
        id: 'rewrite-source',
        stage: 'beforeValidate',
        command: 'node rewrite-source.js',
        fileGlobs: ['*.ts'],
        description: 'Attempts to rewrite source directly.',
        policy: 'evidence',
        effect: 'write',
      },
    ],
    executions: [
      {
        hookId: 'quality-veto',
        status: 'failed',
        exitCode: 1,
        evidenceRef: 'terminal:hook-quality-veto:failed',
      },
      {
        hookId: 'style-warning',
        status: 'bypassed',
        reason: 'disabled by test profile',
      },
    ],
  });

  assert.equal(receipt.protocol, 'devseek.hook-policy/v1');
  assert.equal(receipt.settlementAuthority, 'parent-kernel');
  assert.equal(receipt.trustRoot, false);
  assert.equal(receipt.directWriterAllowed, false);
  assert.deepEqual(receipt.selectedHooks.map(hook => hook.id), ['quality-veto', 'style-warning', 'rewrite-source']);
  assert.equal(receipt.selectedHooks.find(hook => hook.id === 'quality-veto')?.policyKind, 'veto');
  assert.equal(receipt.selectedHooks.find(hook => hook.id === 'quality-veto')?.policyVersion, 'quality/v1');
  assert.equal(receipt.selectedHooks.find(hook => hook.id === 'rewrite-source')?.allowedToRun, false);
  assert.equal(receipt.selectedHooks.find(hook => hook.id === 'rewrite-source')?.directWriteAllowed, false);
  assert.ok(receipt.vetoes.includes('hook-failure-visible:quality-veto'));
  assert.ok(receipt.violations.includes('hook-bypass-visible:style-warning'));
  assert.ok(receipt.violations.includes('hook-direct-writer-denied:rewrite-source'));
  assert.ok(receipt.evidenceRefs.includes('terminal:hook-quality-veto:failed'));
  assert.ok(receipt.evidenceRefs.some(ref => ref.startsWith('hook-bypass:style-warning:')));

  const sensitive = planner.planPolicy({ stage: 'beforeEdit', changedFiles: ['.env'] });
  assert.deepEqual(sensitive.selectedHooks, []);
  assert.ok(sensitive.vetoes.includes('sensitive-file:.env'));
});

test('SkillDiscoveryService parses and selects skills by trigger', () => {
  const service = new SkillDiscoveryService();
  const skills = service.discover([
    {
      path: 'skills/react/SKILL.md',
      content: '# React UI\n\ndescription: Build React views\ntriggers: react, component, ui',
    },
    {
      path: 'notes/README.md',
      content: '# Ignore me',
    },
  ]);

  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'React UI');
  assert.deepEqual(service.select('please build a react component', skills).map(skill => skill.name), ['React UI']);
});

test('R3-07A SkillDiscoveryService plans progressive skill execution without completion or permission escape', () => {
  const service = new SkillDiscoveryService();
  const receipt = service.planExecution({
    prompt: 'please build a react component',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React UI',
          '',
          'description: Build React views',
          'triggers: react, component, ui',
          'input_schema: {"type":"object","required":["targetFiles"]}',
          'tool_kinds: read, search, edit',
          'can_complete: true',
        ].join('\n'),
      },
      {
        path: 'skills/deploy/SKILL.md',
        content: [
          '# Deploy',
          '',
          'description: deploy production with secret=should-not-load',
          'triggers: production',
          'tool_kinds: terminal',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit', 'terminal'],
  });

  assert.equal(receipt.protocol, 'devseek.skill-execution/v1');
  assert.equal(receipt.settlementAuthority, 'parent-kernel');
  assert.equal(receipt.canCompleteTask, false);
  assert.equal(receipt.loadedSkills.length, 1);
  assert.equal(receipt.loadedSkills[0].name, 'React UI');
  assert.equal(receipt.loadedSkills[0].selectedByTrigger, 'react');
  assert.deepEqual(receipt.loadedSkills[0].inputSchema.required, ['targetFiles']);
  assert.equal(receipt.loadedSkills[0].completionClaimsAllowed, false);
  assert.equal(receipt.permissionDecisions.find(decision => decision.kind === 'read')?.action, 'allow');
  assert.equal(receipt.permissionDecisions.find(decision => decision.kind === 'edit')?.action, 'deny');
  assert.equal(receipt.permissionDecisions.find(decision => decision.kind === 'terminal')?.action, 'deny');
  assert.ok(receipt.violations.includes('skill-completion-claim-rejected'));
  assert.ok(receipt.violations.includes('skill-tool-kind-denied:edit'));
  assert.ok(receipt.violations.includes('skill-tool-kind-denied:terminal'));
  assert.equal(receipt.evidenceRefs[0].startsWith('skill:skills/react/SKILL.md:'), true);
  assert.doesNotMatch(JSON.stringify(receipt), /Deploy|should-not-load/);

  const noMatch = service.planExecution({
    prompt: 'write a SQL query',
    candidates: [
      {
        path: 'skills/deploy/SKILL.md',
        content: 'description: deploy production with secret=still-not-loaded\ntriggers: production',
      },
    ],
  });
  assert.equal(noMatch.loadedSkills.length, 0);
  assert.ok(noMatch.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.doesNotMatch(JSON.stringify(noMatch), /still-not-loaded/);
});

test('SubagentRegistry selects review, diagnostics, tests, and migration contracts', () => {
  const registry = new SubagentRegistry();
  const selected = registry.select({
    prompt: '重构后测试失败，请复现并修复',
    changedFileCount: 5,
    validationFailed: true,
  });

  assert.deepEqual(selected.map(agent => agent.kind), [
    'reviewer',
    'test-writer',
    'diagnostics',
    'migration-planner',
  ]);
  assert.equal(selected.find(agent => agent.kind === 'migration-planner')?.requiresApproval, true);
});

test('McpPermissionService inherits permission domains and GitPrAssistantService summarizes evidence', () => {
  const mcp = new McpPermissionService().decide({
    server: 'github',
    name: 'createPullRequest',
    risk: 'network',
  });
  assert.equal(mcp.requiresApproval, true);
  assert.equal(mcp.inheritedPermissionDomain, 'network');

  const summary = new GitPrAssistantService().summarize({
    changedFiles: ['packages/shared/src/engineering-context.ts', 'packages/shared/src/agent-enhancements.ts'],
    validationPassed: true,
    evidenceRefs: ['shared:test'],
  });
  assert.equal(summary.title, 'packages: validated');
  assert.match(summary.body, /Evidence: shared:test/);
  assert.equal(summary.checklist.some(item => item.includes('AgentCommand / AgentEvent')), true);
});

test('R3-07C McpPermissionService binds trust, risk, and capability to parent effect authority', () => {
  const service = new McpPermissionService();
  const receipt = service.evaluateTrust({
    callerPermissionDomains: ['inspect'],
    trustedServers: [
      {
        server: 'github',
        signature: 'sig:github:v1',
        permissionDomains: ['inspect', 'network'],
      },
      {
        server: 'box',
        signature: 'sig:box:v1',
        permissionDomains: ['inspect'],
        revoked: true,
      },
    ],
    tools: [
      {
        server: 'github',
        name: 'listIssues',
        risk: 'read',
        serverSignature: 'sig:github:v1',
        capabilityToken: 'secret-read-token',
      },
      {
        server: 'unknown',
        name: 'writeFile',
        risk: 'write',
      },
      {
        server: 'github',
        name: 'createPullRequest',
        risk: 'network',
        serverSignature: 'sig:github:v1',
        capabilityToken: 'secret-network-token',
      },
      {
        server: 'github',
        name: 'deleteRepository',
        risk: 'destructive',
        serverSignature: 'bad-signature',
      },
      {
        server: 'box',
        name: 'uploadFile',
        risk: 'write',
        serverSignature: 'sig:box:v1',
      },
    ],
  });

  assert.equal(receipt.protocol, 'devseek.mcp-trust/v1');
  assert.equal(receipt.settlementAuthority, 'parent-kernel');
  assert.equal(receipt.effectAuthority, 'B4-effect-authority');
  assert.equal(receipt.capabilityEscapesAllowed, false);
  assert.equal(receipt.decisions.find(decision => decision.tool === 'github.listIssues')?.action, 'allow');
  assert.equal(receipt.decisions.find(decision => decision.tool === 'unknown.writeFile')?.action, 'veto');
  assert.equal(receipt.decisions.find(decision => decision.tool === 'github.createPullRequest')?.action, 'veto');
  assert.equal(receipt.decisions.find(decision => decision.tool === 'github.deleteRepository')?.action, 'veto');
  assert.equal(receipt.decisions.find(decision => decision.tool === 'box.uploadFile')?.action, 'veto');
  assert.ok(receipt.vetoes.includes('mcp-unknown-mutable-veto:unknown.writeFile'));
  assert.ok(receipt.vetoes.includes('mcp-permission-escape-veto:github.createPullRequest'));
  assert.ok(receipt.vetoes.includes('mcp-unsigned-server-veto:github.deleteRepository'));
  assert.ok(receipt.vetoes.includes('mcp-revoked-server-veto:box.uploadFile'));
  assert.ok(receipt.evidenceRefs.some(ref => ref.startsWith('mcp-capability:github.createPullRequest:')));
  assert.doesNotMatch(JSON.stringify(receipt), /secret-read-token|secret-network-token/);
});
