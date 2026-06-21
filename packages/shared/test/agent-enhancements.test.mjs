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
