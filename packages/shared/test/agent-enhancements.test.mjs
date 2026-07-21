import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExtensionProfilePlanService,
  GitPrAssistantService,
  HookPlanner,
  McpPermissionService,
  PluginSupplyChainService,
  SkillDiscoveryService,
  SKILL_EXECUTION_PROTOCOL,
  SUBAGENT_CONTRACT_PROTOCOL,
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

test('R3-07F-skill ExtensionProfilePlanService signs immutable skill denominator plan without executing slots', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'a3c6cbaf44b77083e5fadb7ded32ee451e2d85c4',
    schemaVersion: 'devseek.skill-execution/v1',
  });

  assert.equal(plan.protocol, 'devseek.extension-profile-plan/v1');
  assert.equal(plan.profileId, 'R3-07F-skill-PROFILE-PLAN');
  assert.equal(plan.kind, 'skill');
  assert.equal(plan.singleOwner, 'ExtensionProfilePlanService');
  assert.equal(plan.settlementAuthority, 'parent-kernel');
  assert.equal(plan.status, 'signed');
  assert.equal(plan.immutable, true);
  assert.equal(plan.denominatorExecutionAllowed, false);
  assert.equal(plan.slotExecutionAllowed, false);
  assert.equal(plan.aggregateExecutionAllowed, false);
  assert.equal(plan.taskSlots.length, 20);
  assert.equal(plan.permissionFaultSlots.length, 100);
  assert.equal(new Set(plan.slotIds).size, 120);
  assert.equal(plan.taskSlots[0].slotId, 'R3-07S-skill-TASK-001');
  assert.equal(plan.permissionFaultSlots[99].slotId, 'R3-07S-skill-PERMISSION-FAULT-100');
  assert.ok(plan.taskSlots.every(slot => slot.candidateCommit === plan.candidateCommit));
  assert.ok(plan.taskSlots.every(slot => slot.schemaVersion === plan.schemaVersion));
  assert.ok(plan.permissionFaultSlots.every(slot => slot.oracleRef.startsWith('oracle:skill:permission-fault:')));
  assert.deepEqual(plan.oracleCatalog.counts, { task: 20, permissionFault: 100 });

  const changedCandidate = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    schemaVersion: 'devseek.skill-execution/v1',
  });
  assert.notEqual(changedCandidate.planSignature, plan.planSignature);

  const blocked = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '',
    schemaVersion: '',
  });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.violations.includes('profile-plan-missing-candidate-commit'));
  assert.ok(blocked.violations.includes('profile-plan-missing-schema-version'));
});

test('R3-07F-hook ExtensionProfilePlanService binds hook profile plans to hook policy schema', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'hook',
    candidateCommit: 'd2aa385940c77597572cc8b78d341f691d21ff16',
    schemaVersion: 'devseek.hook-policy/v1',
  });

  assert.equal(plan.profileId, 'R3-07F-hook-PROFILE-PLAN');
  assert.equal(plan.kind, 'hook');
  assert.equal(plan.status, 'signed');
  assert.equal(plan.taskSlots.length, 20);
  assert.equal(plan.permissionFaultSlots.length, 100);
  assert.equal(plan.taskSlots[0].slotId, 'R3-07S-hook-TASK-001');
  assert.equal(plan.permissionFaultSlots[99].slotId, 'R3-07S-hook-PERMISSION-FAULT-100');
  assert.ok(plan.taskSlots.every(slot => slot.schemaVersion === 'devseek.hook-policy/v1'));

  const wrongSchema = service.createProfilePlan({
    kind: 'hook',
    candidateCommit: 'd2aa385940c77597572cc8b78d341f691d21ff16',
    schemaVersion: 'devseek.skill-execution/v1',
  });
  assert.equal(wrongSchema.status, 'blocked');
  assert.ok(wrongSchema.violations.includes('profile-plan-schema-kind-mismatch:hook'));
});

test('R3-07F-mcp ExtensionProfilePlanService binds MCP profile plans to trust schema', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'mcp',
    candidateCommit: '726be94a772a76ac91b404298d55373f26043df9',
    schemaVersion: 'devseek.mcp-trust/v1',
  });

  assert.equal(plan.profileId, 'R3-07F-mcp-PROFILE-PLAN');
  assert.equal(plan.kind, 'mcp');
  assert.equal(plan.status, 'signed');
  assert.equal(plan.taskSlots.length, 20);
  assert.equal(plan.permissionFaultSlots.length, 100);
  assert.equal(plan.taskSlots[0].slotId, 'R3-07S-mcp-TASK-001');
  assert.equal(plan.permissionFaultSlots[99].slotId, 'R3-07S-mcp-PERMISSION-FAULT-100');
  assert.ok(plan.permissionFaultSlots.every(slot => slot.schemaVersion === 'devseek.mcp-trust/v1'));

  const wrongSchema = service.createProfilePlan({
    kind: 'mcp',
    candidateCommit: '726be94a772a76ac91b404298d55373f26043df9',
    schemaVersion: 'devseek.plugin-supply-chain/v1',
  });
  assert.equal(wrongSchema.status, 'blocked');
  assert.ok(wrongSchema.violations.includes('profile-plan-schema-kind-mismatch:mcp'));

  const invalidKind = service.createProfilePlan({
    kind: 'mcp-unsafe',
    candidateCommit: '726be94a772a76ac91b404298d55373f26043df9',
    schemaVersion: 'devseek.mcp-trust/v1',
  });
  assert.equal(invalidKind.status, 'blocked');
  assert.ok(invalidKind.violations.includes('profile-plan-invalid-kind'));
  assert.notEqual(invalidKind.profileId, 'R3-07F-mcp-PROFILE-PLAN');
});

test('R3-07F-plugin ExtensionProfilePlanService binds plugin profile plans to supply-chain schema', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'plugin',
    candidateCommit: 'c7bbce6d924ddc58e52b03cbf36f77e39df3f7c1',
    schemaVersion: 'devseek.plugin-supply-chain/v1',
  });

  assert.equal(plan.profileId, 'R3-07F-plugin-PROFILE-PLAN');
  assert.equal(plan.kind, 'plugin');
  assert.equal(plan.status, 'signed');
  assert.equal(plan.denominatorExecutionAllowed, false);
  assert.equal(plan.slotExecutionAllowed, false);
  assert.equal(plan.aggregateExecutionAllowed, false);
  assert.equal(plan.taskSlots.length, 20);
  assert.equal(plan.permissionFaultSlots.length, 100);
  assert.equal(plan.taskSlots[0].slotId, 'R3-07S-plugin-TASK-001');
  assert.equal(plan.permissionFaultSlots[99].slotId, 'R3-07S-plugin-PERMISSION-FAULT-100');
  assert.ok(plan.slotIds.every(slotId => slotId.startsWith('R3-07S-plugin-')));
  assert.ok(plan.oracleCatalog.oracleRefs.every(ref => ref.includes(':plugin:')));

  const wrongSchema = service.createProfilePlan({
    kind: 'plugin',
    candidateCommit: 'c7bbce6d924ddc58e52b03cbf36f77e39df3f7c1',
    schemaVersion: 'devseek.mcp-trust/v1',
  });
  assert.equal(wrongSchema.status, 'blocked');
  assert.ok(wrongSchema.violations.includes('profile-plan-schema-kind-mismatch:plugin'));
});

test('R3-07F-subagent ExtensionProfilePlanService binds subagent profile plans to contract schema', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'subagent',
    candidateCommit: '509bcf6ab009ad8c318fe9334842a62267d4b6c7',
    schemaVersion: SUBAGENT_CONTRACT_PROTOCOL,
  });

  assert.equal(SUBAGENT_CONTRACT_PROTOCOL, 'devseek.subagent-contract/v1');
  assert.equal(plan.profileId, 'R3-07F-subagent-PROFILE-PLAN');
  assert.equal(plan.kind, 'subagent');
  assert.equal(plan.status, 'signed');
  assert.equal(plan.taskSlots.length, 20);
  assert.equal(plan.permissionFaultSlots.length, 100);
  assert.equal(plan.taskSlots[0].slotId, 'R3-07S-subagent-TASK-001');
  assert.equal(plan.permissionFaultSlots[99].slotId, 'R3-07S-subagent-PERMISSION-FAULT-100');
  assert.ok(plan.taskSlots.every(slot => slot.schemaVersion === SUBAGENT_CONTRACT_PROTOCOL));
  assert.ok(plan.permissionFaultSlots.every(slot => slot.schemaVersion === SUBAGENT_CONTRACT_PROTOCOL));

  const wrongSchema = service.createProfilePlan({
    kind: 'subagent',
    candidateCommit: '509bcf6ab009ad8c318fe9334842a62267d4b6c7',
    schemaVersion: 'devseek.skill-execution/v1',
  });
  assert.equal(wrongSchema.status, 'blocked');
  assert.ok(wrongSchema.violations.includes('profile-plan-schema-kind-mismatch:subagent'));
});

test('R3-07S-skill-TASK-001 ExtensionProfilePlanService records one append-only skill slot receipt', () => {
  const service = new ExtensionProfilePlanService();
  const skillReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: 'description: Build React views\ntriggers: react\ntool_kinds: read',
      },
    ],
    requestedToolKinds: ['read'],
  });
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '8fd61a3830cff653c6f0d21d554341f85a2b419a',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-001',
    attemptId: 'skill-task-001-attempt-001',
    status: 'passed',
    childReceipt: skillReceipt,
    effectRefs: ['skill-discovery:read:SKILL.md'],
    receiptRefs: ['skill-execution:receipt:task-001'],
  });

  assert.equal(receipt.protocol, 'devseek.extension-profile-slot-execution/v1');
  assert.equal(receipt.singleOwner, 'ExtensionProfilePlanService');
  assert.equal(receipt.profileId, 'R3-07F-skill-PROFILE-PLAN');
  assert.equal(receipt.slotId, 'R3-07S-skill-TASK-001');
  assert.equal(receipt.slotKind, 'task');
  assert.equal(receipt.index, 1);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.replacesPriorAttempt, false);
  assert.equal(receipt.priorAttemptPolicy, 'append-only-no-replacement');
  assert.equal(receipt.oracleRef, plan.taskSlots[0].oracleRef);
  assert.equal(receipt.effectRefs.length, 1);
  assert.match(receipt.effectRefs[0], /^extension-profile-slot-effect:R3-07S-skill-TASK-001:/);
  assert.equal(receipt.receiptRefs.length, 1);
  assert.match(receipt.receiptRefs[0], /^extension-profile-slot-receipt:R3-07S-skill-TASK-001:/);
  assert.ok(receipt.evidenceRefs.includes(plan.taskSlots[0].oracleRef));

  const replacementService = new ExtensionProfilePlanService();
  const replacementPlan = replacementService.createProfilePlan({
    kind: 'skill',
    candidateCommit: '8fd61a3830cff653c6f0d21d554341f85a2b419a',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const failed = replacementService.recordSlotExecution({
    plan: replacementPlan,
    slotId: 'R3-07S-skill-TASK-001',
    attemptId: 'skill-task-001-attempt-failed',
    status: 'failed',
    failureRefs: ['skill-execution:failure:task-001'],
  });
  const replacement = replacementService.recordSlotExecution({
    plan: replacementPlan,
    slotId: 'R3-07S-skill-TASK-001',
    attemptId: 'skill-task-001-attempt-replacement',
    status: 'passed',
    effectRefs: ['skill-discovery:replacement-effect'],
    receiptRefs: ['skill-execution:replacement-receipt'],
    previousReceipts: [failed],
  });
  assert.equal(replacement.status, 'blocked');
  assert.ok(replacement.vetoes.includes('slot-replacement-veto:R3-07S-skill-TASK-001'));
  assert.deepEqual(replacement.previousAttemptIds, ['skill-task-001-attempt-failed']);
  assert.deepEqual(replacement.effectRefs, []);
  assert.deepEqual(replacement.receiptRefs, []);

  const unknown = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-999',
    attemptId: 'skill-task-999-attempt-001',
    status: 'passed',
  });
  assert.equal(unknown.status, 'blocked');
  assert.ok(unknown.vetoes.includes('slot-not-in-profile-veto:R3-07S-skill-TASK-999'));
});

test('R3-07S-skill-TASK-002 ExtensionProfilePlanService binds passed slot execution to skill child receipt', () => {
  const service = new ExtensionProfilePlanService();
  const skillReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React UI',
          '',
          'description: Build React views',
          'triggers: react, component',
          'tool_kinds: read',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read'],
  });
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'aa53ad8dbd71983481fd379a6f251f66a5e9b386',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-002',
    attemptId: 'skill-task-002-attempt-001',
    status: 'passed',
    childReceipt: skillReceipt,
    effectRefs: ['skill-discovery:read:skills/react/SKILL.md'],
    receiptRefs: ['skill-execution:receipt:task-002'],
  });

  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.slotId, 'R3-07S-skill-TASK-002');
  assert.equal(receipt.childReceiptRequired, true);
  assert.equal(receipt.childProtocol, SKILL_EXECUTION_PROTOCOL);
  assert.deepEqual(receipt.childEvidenceRefs, skillReceipt.evidenceRefs);
  assert.ok(receipt.evidenceRefs.includes(skillReceipt.evidenceRefs[0]));

  const missingChild = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-002',
    attemptId: 'skill-task-002-attempt-missing-child',
    status: 'passed',
    effectRefs: ['skill-discovery:should-not-commit'],
    receiptRefs: ['skill-execution:should-not-commit'],
  });
  assert.equal(missingChild.status, 'blocked');
  assert.ok(missingChild.vetoes.includes('slot-child-receipt-missing-veto:R3-07S-skill-TASK-002'));
  assert.deepEqual(missingChild.effectRefs, []);
  assert.deepEqual(missingChild.receiptRefs, []);

  const wrongProtocol = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-002',
    attemptId: 'skill-task-002-attempt-wrong-protocol',
    status: 'passed',
    childReceipt: {
      protocol: 'devseek.hook-policy/v1',
      evidenceRefs: ['hook-policy:should-not-qualify-skill-slot'],
    },
  });
  assert.equal(wrongProtocol.status, 'blocked');
  assert.ok(wrongProtocol.vetoes.includes('slot-child-protocol-mismatch-veto:R3-07S-skill-TASK-002'));
  assert.equal(wrongProtocol.childProtocol, 'devseek.hook-policy/v1');
});

test('R3-07S-skill-TASK-003 ExtensionProfilePlanService rejects child receipts without evidence or parent authority', () => {
  const service = new ExtensionProfilePlanService();
  const skillReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: 'description: Build React views\ntriggers: react\ntool_kinds: read',
      },
    ],
    requestedToolKinds: ['read'],
  });
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'a063a5c5afed15f8bfea9468ad199688e6814828',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-003',
    attemptId: 'skill-task-003-attempt-001',
    status: 'passed',
    childReceipt: skillReceipt,
    effectRefs: ['skill-discovery:read:skills/react/SKILL.md'],
    receiptRefs: ['skill-execution:receipt:task-003'],
  });
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.childSettlementAuthority, 'parent-kernel');
  assert.equal(receipt.childEvidenceRequired, true);

  const noEvidence = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-003',
    attemptId: 'skill-task-003-attempt-no-evidence',
    status: 'passed',
    childReceipt: {
      protocol: SKILL_EXECUTION_PROTOCOL,
      settlementAuthority: 'parent-kernel',
      evidenceRefs: [],
    },
    effectRefs: ['skill-discovery:should-not-commit'],
    receiptRefs: ['skill-execution:should-not-commit'],
  });
  assert.equal(noEvidence.status, 'blocked');
  assert.ok(noEvidence.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-TASK-003'));
  assert.deepEqual(noEvidence.effectRefs, []);
  assert.deepEqual(noEvidence.receiptRefs, []);

  const wrongAuthority = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-003',
    attemptId: 'skill-task-003-attempt-wrong-authority',
    status: 'passed',
    childReceipt: {
      protocol: SKILL_EXECUTION_PROTOCOL,
      settlementAuthority: 'child-agent',
      evidenceRefs: ['skill:forged-child-authority'],
    },
  });
  assert.equal(wrongAuthority.status, 'blocked');
  assert.ok(wrongAuthority.vetoes.includes('slot-child-settlement-authority-veto:R3-07S-skill-TASK-003'));
  assert.equal(wrongAuthority.childSettlementAuthority, 'child-agent');
});

test('R3-07S-skill-TASK-004 ExtensionProfilePlanService scopes replacement attempts to signed plan identity', () => {
  const service = new ExtensionProfilePlanService();
  const skillReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: 'description: Build React views\ntriggers: react\ntool_kinds: read',
      },
    ],
    requestedToolKinds: ['read'],
  });
  const oldPlan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1111111111111111111111111111111111111111',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const currentPlan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '2222222222222222222222222222222222222222',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const oldReceipt = service.recordSlotExecution({
    plan: oldPlan,
    slotId: 'R3-07S-skill-TASK-004',
    attemptId: 'skill-task-004-old-candidate',
    status: 'passed',
    childReceipt: skillReceipt,
    effectRefs: ['skill-discovery:old-candidate'],
    receiptRefs: ['skill-execution:old-candidate'],
  });
  assert.equal(oldReceipt.status, 'passed');

  const receipt = service.recordSlotExecution({
    plan: currentPlan,
    slotId: 'R3-07S-skill-TASK-004',
    attemptId: 'skill-task-004-current-candidate',
    status: 'passed',
    childReceipt: skillReceipt,
    previousReceipts: [oldReceipt],
    effectRefs: ['skill-discovery:current-candidate'],
    receiptRefs: ['skill-execution:current-candidate'],
  });
  assert.equal(receipt.status, 'passed');
  assert.deepEqual(receipt.previousAttemptIds, []);
  assert.equal(receipt.candidateCommit, currentPlan.candidateCommit);
  assert.ok(!receipt.vetoes.includes('slot-replacement-veto:R3-07S-skill-TASK-004'));

  const replacement = service.recordSlotExecution({
    plan: currentPlan,
    slotId: 'R3-07S-skill-TASK-004',
    attemptId: 'skill-task-004-replacement',
    status: 'passed',
    childReceipt: skillReceipt,
    previousReceipts: [receipt],
  });
  assert.equal(replacement.status, 'blocked');
  assert.deepEqual(replacement.previousAttemptIds, ['skill-task-004-current-candidate']);
  assert.ok(replacement.vetoes.includes('slot-replacement-veto:R3-07S-skill-TASK-004'));
});

test('R3-07S-skill-TASK-005 ExtensionProfilePlanService keeps failed slots failure-only', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '3333333333333333333333333333333333333333',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const failed = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-005',
    attemptId: 'skill-task-005-failed',
    status: 'failed',
    failureRefs: ['skill-execution:failure:task-005'],
    effectRefs: ['skill-discovery:should-not-commit-on-failure'],
    receiptRefs: ['skill-execution:should-not-commit-on-failure'],
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureRefs.length, 1);
  assert.match(failed.failureRefs[0], /^extension-profile-slot-failure:R3-07S-skill-TASK-005:/);
  assert.deepEqual(failed.effectRefs, []);
  assert.deepEqual(failed.receiptRefs, []);
  assert.ok(failed.evidenceRefs.includes(failed.failureRefs[0]));
  assert.ok(!failed.evidenceRefs.includes('skill-execution:failure:task-005'));
  assert.ok(!failed.evidenceRefs.includes('skill-discovery:should-not-commit-on-failure'));
  assert.ok(!failed.evidenceRefs.includes('skill-execution:should-not-commit-on-failure'));

  const missingFailureEvidence = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-005',
    attemptId: 'skill-task-005-missing-failure-evidence',
    status: 'failed',
    effectRefs: ['skill-discovery:should-not-commit-missing-failure'],
    receiptRefs: ['skill-execution:should-not-commit-missing-failure'],
  });
  assert.equal(missingFailureEvidence.status, 'blocked');
  assert.ok(missingFailureEvidence.vetoes.includes('slot-failure-evidence-missing-veto:R3-07S-skill-TASK-005'));
  assert.deepEqual(missingFailureEvidence.effectRefs, []);
  assert.deepEqual(missingFailureEvidence.receiptRefs, []);
});

test('R3-07S-skill-TASK-006 ExtensionProfilePlanService keeps vetoed slots distinct from blocked input', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '4444444444444444444444444444444444444444',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const vetoed = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-006',
    attemptId: 'skill-task-006-vetoed',
    status: 'vetoed',
    vetoes: ['skill-policy:veto:task-006'],
    effectRefs: ['skill-discovery:should-not-commit-on-veto'],
    receiptRefs: ['skill-execution:should-not-commit-on-veto'],
  });
  assert.equal(vetoed.status, 'vetoed');
  assert.equal(vetoed.vetoes.length, 1);
  assert.match(vetoed.vetoes[0], /^extension-profile-slot-veto:R3-07S-skill-TASK-006:/);
  assert.deepEqual(vetoed.effectRefs, []);
  assert.deepEqual(vetoed.receiptRefs, []);
  assert.ok(vetoed.evidenceRefs.includes(vetoed.vetoes[0]));
  assert.ok(!vetoed.evidenceRefs.includes('skill-policy:veto:task-006'));
  assert.ok(!vetoed.evidenceRefs.includes('skill-discovery:should-not-commit-on-veto'));

  const missingVetoEvidence = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-006',
    attemptId: 'skill-task-006-missing-veto-evidence',
    status: 'vetoed',
    effectRefs: ['skill-discovery:should-not-commit-missing-veto'],
    receiptRefs: ['skill-execution:should-not-commit-missing-veto'],
  });
  assert.equal(missingVetoEvidence.status, 'blocked');
  assert.ok(missingVetoEvidence.vetoes.includes('slot-veto-evidence-missing-veto:R3-07S-skill-TASK-006'));
  assert.deepEqual(missingVetoEvidence.effectRefs, []);
  assert.deepEqual(missingVetoEvidence.receiptRefs, []);

  const passedWithVeto = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-006',
    attemptId: 'skill-task-006-passed-with-veto',
    status: 'passed',
    vetoes: ['skill-policy:unexpected-veto-on-pass'],
  });
  assert.equal(passedWithVeto.status, 'blocked');
  assert.ok(passedWithVeto.vetoes.some(ref => /^extension-profile-slot-veto:R3-07S-skill-TASK-006:/.test(ref)));
  assert.ok(!passedWithVeto.vetoes.includes('skill-policy:unexpected-veto-on-pass'));
});

test('R3-07S-skill-TASK-007 ExtensionProfilePlanService quarantines child evidence for non-passed slots', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '5555555555555555555555555555555555555555',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const dirtyChildReceipt = {
    protocol: SKILL_EXECUTION_PROTOCOL,
    settlementAuthority: 'parent-kernel',
    evidenceRefs: ['skill-child:evidence:should-not-project'],
    violations: ['skill-child:violation:should-not-project'],
    vetoes: ['skill-child:veto:should-not-project'],
  };

  const failed = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-007',
    attemptId: 'skill-task-007-failed',
    status: 'failed',
    childReceipt: dirtyChildReceipt,
    failureRefs: ['skill-execution:failure:task-007'],
  });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.childEvidenceRefs, []);
  assert.deepEqual(failed.childViolations, []);
  assert.equal(failed.failureRefs.length, 1);
  assert.match(failed.failureRefs[0], /^extension-profile-slot-failure:R3-07S-skill-TASK-007:/);
  assert.ok(failed.evidenceRefs.includes(failed.failureRefs[0]));
  assert.ok(!failed.evidenceRefs.includes('skill-execution:failure:task-007'));
  assert.ok(!failed.evidenceRefs.includes('skill-child:evidence:should-not-project'));
  assert.ok(!failed.evidenceRefs.includes('skill-child:violation:should-not-project'));
  assert.ok(!failed.evidenceRefs.includes('skill-child:veto:should-not-project'));

  const blocked = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-007',
    attemptId: 'skill-task-007-blocked',
    status: 'passed',
    childReceipt: dirtyChildReceipt,
    effectRefs: ['skill-effect:should-not-project-blocked'],
    receiptRefs: ['skill-receipt:should-not-project-blocked'],
  });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.vetoes.includes('slot-child-receipt-not-clean-veto:R3-07S-skill-TASK-007'));
  assert.deepEqual(blocked.childEvidenceRefs, []);
  assert.ok(blocked.childViolations.includes('skill-child:violation:should-not-project'));
  assert.ok(blocked.childViolations.includes('skill-child:veto:should-not-project'));
  assert.ok(blocked.evidenceRefs.includes('slot-child-receipt-not-clean-veto:R3-07S-skill-TASK-007'));
  assert.ok(!blocked.evidenceRefs.includes('skill-child:evidence:should-not-project'));
  assert.ok(!blocked.evidenceRefs.includes('skill-child:violation:should-not-project'));
  assert.ok(!blocked.evidenceRefs.includes('skill-child:veto:should-not-project'));
  assert.ok(!blocked.evidenceRefs.includes('skill-effect:should-not-project-blocked'));
  assert.ok(!blocked.evidenceRefs.includes('skill-receipt:should-not-project-blocked'));

  const vetoService = new ExtensionProfilePlanService();
  const vetoPlan = vetoService.createProfilePlan({
    kind: 'skill',
    candidateCommit: '5555555555555555555555555555555555555555',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const vetoed = vetoService.recordSlotExecution({
    plan: vetoPlan,
    slotId: 'R3-07S-skill-TASK-007',
    attemptId: 'skill-task-007-vetoed',
    status: 'vetoed',
    childReceipt: dirtyChildReceipt,
    vetoes: ['skill-policy:veto:task-007'],
  });
  assert.equal(vetoed.status, 'vetoed');
  assert.deepEqual(vetoed.childEvidenceRefs, []);
  assert.deepEqual(vetoed.childViolations, []);
  assert.equal(vetoed.vetoes.length, 1);
  assert.match(vetoed.vetoes[0], /^extension-profile-slot-veto:R3-07S-skill-TASK-007:/);
  assert.ok(vetoed.evidenceRefs.includes(vetoed.vetoes[0]));
  assert.ok(!vetoed.evidenceRefs.includes('skill-policy:veto:task-007'));
  assert.ok(!vetoed.evidenceRefs.includes('skill-child:evidence:should-not-project'));
});

test('R3-07S-skill-TASK-008 ExtensionProfilePlanService rejects invalid runtime slot status', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '6666666666666666666666666666666666666666',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const invalidStatus = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-008',
    attemptId: 'skill-task-008-invalid-status',
    status: 'complete',
    childReceipt: {
      protocol: SKILL_EXECUTION_PROTOCOL,
      settlementAuthority: 'parent-kernel',
      evidenceRefs: ['skill-child:evidence:invalid-status-should-not-project'],
    },
    effectRefs: ['skill-effect:invalid-status-should-not-project'],
    receiptRefs: ['skill-receipt:invalid-status-should-not-project'],
    failureRefs: ['skill-failure:invalid-status-should-not-project'],
    vetoes: ['skill-policy:invalid-status-extra-veto'],
  });
  assert.equal(invalidStatus.status, 'blocked');
  assert.ok(invalidStatus.vetoes.includes('slot-invalid-status-veto:R3-07S-skill-TASK-008'));
  assert.ok(invalidStatus.vetoes.some(ref => /^extension-profile-slot-veto:R3-07S-skill-TASK-008:/.test(ref)));
  assert.ok(!invalidStatus.vetoes.includes('skill-policy:invalid-status-extra-veto'));
  assert.ok(invalidStatus.evidenceRefs.includes('slot-invalid-status-veto:R3-07S-skill-TASK-008'));
  assert.ok(!invalidStatus.evidenceRefs.includes('skill-policy:invalid-status-extra-veto'));
  assert.ok(!invalidStatus.evidenceRefs.includes('skill-child:evidence:invalid-status-should-not-project'));
  assert.ok(!invalidStatus.evidenceRefs.includes('skill-effect:invalid-status-should-not-project'));
  assert.ok(!invalidStatus.evidenceRefs.includes('skill-receipt:invalid-status-should-not-project'));
  assert.ok(!invalidStatus.evidenceRefs.includes('skill-failure:invalid-status-should-not-project'));
});

test('R3-07S-skill-TASK-009 ExtensionProfilePlanService rejects caller-supplied blocked status', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '7777777777777777777777777777777777777777',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const blockedInput = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-009',
    attemptId: 'skill-task-009-blocked-input',
    status: 'blocked',
    effectRefs: ['skill-effect:blocked-input-should-not-project'],
    receiptRefs: ['skill-receipt:blocked-input-should-not-project'],
  });
  assert.equal(blockedInput.status, 'blocked');
  assert.ok(blockedInput.vetoes.includes('slot-invalid-status-veto:R3-07S-skill-TASK-009'));
  assert.ok(blockedInput.evidenceRefs.includes('slot-invalid-status-veto:R3-07S-skill-TASK-009'));
  assert.deepEqual(blockedInput.effectRefs, []);
  assert.deepEqual(blockedInput.receiptRefs, []);
  assert.ok(!blockedInput.evidenceRefs.includes('skill-effect:blocked-input-should-not-project'));
  assert.ok(!blockedInput.evidenceRefs.includes('skill-receipt:blocked-input-should-not-project'));
});

test('R3-07S-skill-TASK-010 ExtensionProfilePlanService scopes terminal evidence fields to final status', () => {
  const service = new ExtensionProfilePlanService();
  const skillReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: 'description: Build React views\ntriggers: react\ntool_kinds: read',
      },
    ],
    requestedToolKinds: ['read'],
  });
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '8888888888888888888888888888888888888888',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const passed = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-010',
    attemptId: 'skill-task-010-passed',
    status: 'passed',
    childReceipt: skillReceipt,
    effectRefs: ['skill-effect:task-010'],
    receiptRefs: ['skill-receipt:task-010'],
    failureRefs: ['skill-failure:should-not-project-green'],
  });
  assert.equal(passed.status, 'passed');
  assert.deepEqual(passed.failureRefs, []);
  assert.ok(!passed.evidenceRefs.includes('skill-failure:should-not-project-green'));

  const failedService = new ExtensionProfilePlanService();
  const failedPlan = failedService.createProfilePlan({
    kind: 'skill',
    candidateCommit: '8888888888888888888888888888888888888888',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const failed = failedService.recordSlotExecution({
    plan: failedPlan,
    slotId: 'R3-07S-skill-TASK-010',
    attemptId: 'skill-task-010-failed',
    status: 'failed',
    childReceipt: {
      protocol: SKILL_EXECUTION_PROTOCOL,
      settlementAuthority: 'parent-kernel',
      evidenceRefs: ['skill-child:evidence:should-not-project-failed'],
      violations: ['skill-child:violation:should-not-project-failed'],
    },
    effectRefs: ['skill-effect:should-not-project-failed'],
    receiptRefs: ['skill-receipt:should-not-project-failed'],
    failureRefs: ['skill-failure:task-010'],
  });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.childEvidenceRefs, []);
  assert.deepEqual(failed.childViolations, []);
  assert.equal(failed.failureRefs.length, 1);
  assert.match(failed.failureRefs[0], /^extension-profile-slot-failure:R3-07S-skill-TASK-010:/);
  assert.ok(!failed.evidenceRefs.includes('skill-failure:task-010'));
  assert.ok(!failed.evidenceRefs.includes('skill-child:evidence:should-not-project-failed'));
  assert.ok(!failed.evidenceRefs.includes('skill-child:violation:should-not-project-failed'));

  const blockedService = new ExtensionProfilePlanService();
  const blockedPlan = blockedService.createProfilePlan({
    kind: 'skill',
    candidateCommit: '8888888888888888888888888888888888888888',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const blockedByChild = blockedService.recordSlotExecution({
    plan: blockedPlan,
    slotId: 'R3-07S-skill-TASK-010',
    attemptId: 'skill-task-010-blocked-child',
    status: 'passed',
    childReceipt: {
      protocol: SKILL_EXECUTION_PROTOCOL,
      settlementAuthority: 'parent-kernel',
      evidenceRefs: ['skill-child:evidence:should-not-project-blocked'],
      vetoes: ['skill-child:veto:task-010'],
    },
    effectRefs: ['skill-effect:should-not-project-blocked'],
    receiptRefs: ['skill-receipt:should-not-project-blocked'],
  });
  assert.equal(blockedByChild.status, 'blocked');
  assert.deepEqual(blockedByChild.childEvidenceRefs, []);
  assert.ok(blockedByChild.childViolations.includes('skill-child:veto:task-010'));
  assert.ok(blockedByChild.vetoes.includes('slot-child-receipt-not-clean-veto:R3-07S-skill-TASK-010'));
  assert.ok(!blockedByChild.evidenceRefs.includes('skill-child:evidence:should-not-project-blocked'));
});

test('R3-07S-skill-TASK-011 ExtensionProfilePlanService rejects forged signed profile plans', () => {
  const service = new ExtensionProfilePlanService();
  const skillReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: 'description: Build React views\ntriggers: react\ntool_kinds: read',
      },
    ],
    requestedToolKinds: ['read'],
  });
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '9999999999999999999999999999999999999999',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const forgedPlan = {
    ...plan,
    protocol: 'devseek.forged-profile-plan/v1',
    singleOwner: 'CallerSuppliedPlan',
    settlementAuthority: 'child-kernel',
    immutable: false,
    slotExecutionAllowed: true,
    planSignature: 'forged-plan-signature',
    evidenceRefs: ['forged-plan:evidence:should-not-project'],
  };

  const forgedReceipt = service.recordSlotExecution({
    plan: forgedPlan,
    slotId: 'R3-07S-skill-TASK-011',
    attemptId: 'skill-task-011-forged-plan',
    status: 'passed',
    childReceipt: skillReceipt,
    effectRefs: ['skill-effect:forged-plan-should-not-project'],
    receiptRefs: ['skill-receipt:forged-plan-should-not-project'],
  });

  assert.equal(forgedReceipt.status, 'blocked');
  assert.ok(forgedReceipt.vetoes.includes('slot-plan-protocol-mismatch-veto:R3-07F-skill-PROFILE-PLAN'));
  assert.ok(forgedReceipt.vetoes.includes('slot-plan-owner-mismatch-veto:R3-07F-skill-PROFILE-PLAN'));
  assert.ok(forgedReceipt.vetoes.includes('slot-plan-signature-mismatch-veto:R3-07F-skill-PROFILE-PLAN'));
  assert.ok(forgedReceipt.vetoes.includes('slot-plan-slot-execution-veto:R3-07F-skill-PROFILE-PLAN'));
  assert.deepEqual(forgedReceipt.effectRefs, []);
  assert.deepEqual(forgedReceipt.receiptRefs, []);
  assert.ok(forgedReceipt.evidenceRefs.includes('slot-plan-signature-mismatch-veto:R3-07F-skill-PROFILE-PLAN'));
  assert.ok(!forgedReceipt.evidenceRefs.includes('forged-plan:evidence:should-not-project'));
  assert.ok(!forgedReceipt.evidenceRefs.includes('skill-effect:forged-plan-should-not-project'));
  assert.ok(!forgedReceipt.evidenceRefs.includes('skill-receipt:forged-plan-should-not-project'));

  const clonedSignedPlan = {
    ...plan,
    taskSlots: [...plan.taskSlots],
    permissionFaultSlots: [...plan.permissionFaultSlots],
    slotIds: [...plan.slotIds],
    oracleCatalog: {
      version: plan.oracleCatalog.version,
      counts: { ...plan.oracleCatalog.counts },
      oracleRefs: [...plan.oracleCatalog.oracleRefs],
    },
    violations: [...plan.violations],
    evidenceRefs: [...plan.evidenceRefs],
  };
  const clonedReceipt = service.recordSlotExecution({
    plan: clonedSignedPlan,
    slotId: 'R3-07S-skill-TASK-011',
    attemptId: 'skill-task-011-cloned-plan',
    status: 'passed',
    childReceipt: skillReceipt,
    effectRefs: ['skill-effect:cloned-plan-should-not-project'],
    receiptRefs: ['skill-receipt:cloned-plan-should-not-project'],
  });

  assert.equal(clonedReceipt.status, 'blocked');
  assert.ok(clonedReceipt.vetoes.includes('slot-plan-origin-mismatch-veto:R3-07F-skill-PROFILE-PLAN'));
  assert.deepEqual(clonedReceipt.effectRefs, []);
  assert.deepEqual(clonedReceipt.receiptRefs, []);
  assert.ok(clonedReceipt.evidenceRefs.includes('slot-plan-origin-mismatch-veto:R3-07F-skill-PROFILE-PLAN'));
  assert.ok(!clonedReceipt.evidenceRefs.includes(plan.evidenceRefs[0]));
  assert.ok(!clonedReceipt.evidenceRefs.includes('skill-effect:cloned-plan-should-not-project'));
  assert.ok(!clonedReceipt.evidenceRefs.includes('skill-receipt:cloned-plan-should-not-project'));
});

test('R3-07S-skill-TASK-012 ExtensionProfilePlanService freezes signed profile plan evidence', () => {
  const service = new ExtensionProfilePlanService();
  const skillReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: 'description: Build React views\ntriggers: react\ntool_kinds: read',
      },
    ],
    requestedToolKinds: ['read'],
  });
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '9999999999999999999999999999999999999999',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const forgedPlanEvidenceRef = 'forged-plan:evidence:mutable-should-not-project';

  let mutationBlocked = false;
  try {
    plan.evidenceRefs.push(forgedPlanEvidenceRef);
  } catch {
    mutationBlocked = true;
  }

  if (!mutationBlocked) {
    const mutableReceipt = service.recordSlotExecution({
      plan,
      slotId: 'R3-07S-skill-TASK-012',
      attemptId: 'skill-task-012-mutable-plan',
      status: 'passed',
      childReceipt: skillReceipt,
      effectRefs: ['skill-effect:mutable-plan-should-not-project'],
      receiptRefs: ['skill-receipt:mutable-plan-should-not-project'],
    });

    assert.equal(mutableReceipt.status, 'blocked');
    assert.ok(mutableReceipt.vetoes.includes('slot-plan-evidence-extra-veto:R3-07F-skill-PROFILE-PLAN'));
    assert.ok(!mutableReceipt.evidenceRefs.includes(forgedPlanEvidenceRef));
  }

  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.evidenceRefs), true);
  assert.equal(Object.isFrozen(plan.taskSlots), true);
  assert.equal(Object.isFrozen(plan.taskSlots[0]), true);

  const extraEvidencePlan = {
    ...plan,
    evidenceRefs: [...plan.evidenceRefs, forgedPlanEvidenceRef],
  };
  const extraEvidenceReceipt = service.recordSlotExecution({
    plan: extraEvidencePlan,
    slotId: 'R3-07S-skill-TASK-012',
    attemptId: 'skill-task-012-extra-evidence-plan',
    status: 'passed',
    childReceipt: skillReceipt,
    effectRefs: ['skill-effect:extra-evidence-should-not-project'],
    receiptRefs: ['skill-receipt:extra-evidence-should-not-project'],
  });

  assert.equal(extraEvidenceReceipt.status, 'blocked');
  assert.ok(extraEvidenceReceipt.vetoes.includes('slot-plan-evidence-extra-veto:R3-07F-skill-PROFILE-PLAN'));
  assert.ok(!extraEvidenceReceipt.evidenceRefs.includes(forgedPlanEvidenceRef));
  assert.ok(!extraEvidenceReceipt.evidenceRefs.includes('skill-effect:extra-evidence-should-not-project'));
  assert.ok(!extraEvidenceReceipt.evidenceRefs.includes('skill-receipt:extra-evidence-should-not-project'));
});

test('R3-07S-skill-TASK-013 ExtensionProfilePlanService rejects forged skill child receipts', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const forgedChildReceipt = {
    protocol: SKILL_EXECUTION_PROTOCOL,
    settlementAuthority: 'parent-kernel',
    evidenceRefs: ['skill:forged-child-should-not-project'],
    violations: [],
    blockedReasons: [],
    vetoes: [],
  };
  const forged = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-013',
    attemptId: 'skill-task-013-forged-child',
    status: 'passed',
    childReceipt: forgedChildReceipt,
    effectRefs: ['skill-effect:forged-child-should-not-project'],
    receiptRefs: ['skill-receipt:forged-child-should-not-project'],
  });

  assert.equal(forged.status, 'blocked');
  assert.ok(forged.vetoes.includes('slot-child-origin-mismatch-veto:R3-07S-skill-TASK-013'));
  assert.deepEqual(forged.childEvidenceRefs, []);
  assert.deepEqual(forged.effectRefs, []);
  assert.deepEqual(forged.receiptRefs, []);
  assert.ok(!forged.evidenceRefs.includes('skill:forged-child-should-not-project'));
  assert.ok(!forged.evidenceRefs.includes('skill-effect:forged-child-should-not-project'));
  assert.ok(!forged.evidenceRefs.includes('skill-receipt:forged-child-should-not-project'));

  const realChildReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: 'description: Build React views\ntriggers: react\ntool_kinds: read',
      },
    ],
    requestedToolKinds: ['read'],
  });
  assert.equal(Object.isFrozen(realChildReceipt), true);
  assert.equal(Object.isFrozen(realChildReceipt.evidenceRefs), true);

  const passed = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-013',
    attemptId: 'skill-task-013-real-child',
    status: 'passed',
    childReceipt: realChildReceipt,
    effectRefs: ['skill-effect:real-child'],
    receiptRefs: ['skill-receipt:real-child'],
  });
  assert.equal(passed.status, 'passed');
  assert.deepEqual(passed.childEvidenceRefs, realChildReceipt.evidenceRefs);
});

test('R3-07S-skill-TASK-014 ExtensionProfilePlanService derives passed slot success refs', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'abababababababababababababababababababab',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const realChildReceipt = new SkillDiscoveryService().planExecution({
    prompt: 'please use the react skill',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: 'description: Build React views\ntriggers: react\ntool_kinds: read',
      },
    ],
    requestedToolKinds: ['read'],
  });

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-014',
    attemptId: 'skill-task-014-real-child',
    status: 'passed',
    childReceipt: realChildReceipt,
    effectRefs: ['skill-effect:caller-forged-success-ref'],
    receiptRefs: ['skill-receipt:caller-forged-success-ref'],
  });

  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.effectRefs.length, 1);
  assert.match(receipt.effectRefs[0], /^extension-profile-slot-effect:R3-07S-skill-TASK-014:/);
  assert.equal(receipt.receiptRefs.length, 1);
  assert.match(receipt.receiptRefs[0], /^extension-profile-slot-receipt:R3-07S-skill-TASK-014:/);
  assert.ok(!receipt.effectRefs.includes('skill-effect:caller-forged-success-ref'));
  assert.ok(!receipt.receiptRefs.includes('skill-receipt:caller-forged-success-ref'));
  assert.ok(!receipt.evidenceRefs.includes('skill-effect:caller-forged-success-ref'));
  assert.ok(!receipt.evidenceRefs.includes('skill-receipt:caller-forged-success-ref'));
  assert.ok(receipt.evidenceRefs.includes(receipt.effectRefs[0]));
  assert.ok(receipt.evidenceRefs.includes(receipt.receiptRefs[0]));
});

test('R3-07S-skill-TASK-015 ExtensionProfilePlanService derives failed slot failure refs', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-015',
    attemptId: 'skill-task-015-failed',
    status: 'failed',
    failureRefs: ['skill-failure:caller-forged-failure-ref'],
  });

  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.failureRefs.length, 1);
  assert.match(receipt.failureRefs[0], /^extension-profile-slot-failure:R3-07S-skill-TASK-015:/);
  assert.ok(!receipt.failureRefs.includes('skill-failure:caller-forged-failure-ref'));
  assert.ok(!receipt.evidenceRefs.includes('skill-failure:caller-forged-failure-ref'));
  assert.ok(receipt.evidenceRefs.includes(receipt.failureRefs[0]));
});

test('R3-07S-skill-TASK-016 ExtensionProfilePlanService derives terminal veto refs', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const vetoed = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-016',
    attemptId: 'skill-task-016-vetoed',
    status: 'vetoed',
    vetoes: ['skill-veto:caller-forged-veto-ref'],
  });

  assert.equal(vetoed.status, 'vetoed');
  assert.equal(vetoed.vetoes.length, 1);
  assert.match(vetoed.vetoes[0], /^extension-profile-slot-veto:R3-07S-skill-TASK-016:/);
  assert.deepEqual(vetoed.violations, vetoed.vetoes);
  assert.ok(!vetoed.vetoes.includes('skill-veto:caller-forged-veto-ref'));
  assert.ok(!vetoed.violations.includes('skill-veto:caller-forged-veto-ref'));
  assert.ok(!vetoed.evidenceRefs.includes('skill-veto:caller-forged-veto-ref'));
  assert.ok(vetoed.evidenceRefs.includes(vetoed.vetoes[0]));

  const blocked = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-016',
    attemptId: 'skill-task-016-blocked-by-caller-veto',
    status: 'failed',
    failureRefs: ['skill-failure:task-016-real-input'],
    vetoes: ['skill-veto:caller-forged-block-ref'],
  });

  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.vetoes.some(ref => /^extension-profile-slot-veto:R3-07S-skill-TASK-016:/.test(ref)));
  assert.ok(!blocked.vetoes.includes('skill-veto:caller-forged-block-ref'));
  assert.ok(!blocked.violations.includes('skill-veto:caller-forged-block-ref'));
  assert.ok(!blocked.evidenceRefs.includes('skill-veto:caller-forged-block-ref'));
});

test('R3-07S-skill-TASK-017 ExtensionProfilePlanService authenticates previous slot receipts', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'dededededededededededededededededededede',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const forgedPreviousReceipt = {
    profileId: plan.profileId,
    slotId: 'R3-07S-skill-TASK-017',
    candidateCommit: plan.candidateCommit,
    schemaVersion: plan.schemaVersion,
    attemptId: 'skill-task-017-forged-previous',
  };

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-017',
    attemptId: 'skill-task-017-current',
    status: 'failed',
    failureRefs: ['skill-failure:task-017-current'],
    previousReceipts: [forgedPreviousReceipt],
  });

  assert.equal(receipt.status, 'failed');
  assert.deepEqual(receipt.previousAttemptIds, []);
  assert.ok(!receipt.vetoes.includes('slot-replacement-veto:R3-07S-skill-TASK-017'));
  assert.ok(Object.isFrozen(receipt));
  assert.ok(Object.isFrozen(receipt.failureRefs));
  assert.throws(() => {
    receipt.failureRefs.push('skill-failure:mutable-after-return');
  }, TypeError);

  const replacement = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-017',
    attemptId: 'skill-task-017-replacement',
    status: 'failed',
    failureRefs: ['skill-failure:task-017-replacement'],
    previousReceipts: [receipt],
  });

  assert.equal(replacement.status, 'blocked');
  assert.deepEqual(replacement.previousAttemptIds, ['skill-task-017-current']);
  assert.ok(replacement.vetoes.includes('slot-replacement-veto:R3-07S-skill-TASK-017'));
});

test('R3-07S-skill-TASK-018 ExtensionProfilePlanService signs slot execution receipts', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'efefefefefefefefefefefefefefefefefefefef',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-018',
    attemptId: 'skill-task-018-current',
    status: 'failed',
    failureRefs: ['skill-failure:task-018-current'],
  });

  assert.match(receipt.slotExecutionSignature, /^[0-9a-f]{8}$/);
  assert.ok(receipt.evidenceRefs.includes(
    `extension-profile-slot-execution:R3-07S-skill-TASK-018:${receipt.slotExecutionSignature}`,
  ));

  const changedAttempt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-018',
    attemptId: 'skill-task-018-changed',
    status: 'failed',
    failureRefs: ['skill-failure:task-018-current'],
  });

  assert.notEqual(changedAttempt.slotExecutionSignature, receipt.slotExecutionSignature);
});

test('R3-07S-skill-TASK-019 ExtensionProfilePlanService quarantines unauthentic plan identity on blocked receipts', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: 'fefefefefefefefefefefefefefefefefefefefe',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const forgedPlan = {
    ...plan,
    profileId: 'caller-forged-profile',
    kind: 'plugin',
    candidateCommit: 'caller-forged-candidate',
    schemaVersion: 'caller-forged-schema',
    planSignature: 'caller-forged-signature',
    evidenceRefs: ['extension-profile-plan:caller-forged-profile:caller-forged-signature'],
  };

  const receipt = service.recordSlotExecution({
    plan: forgedPlan,
    slotId: 'R3-07S-skill-TASK-019',
    attemptId: 'skill-task-019-forged-plan',
    status: 'failed',
    failureRefs: ['skill-failure:task-019-input'],
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.profileId, 'R3-07F-unauthenticated-PROFILE-PLAN');
  assert.equal(receipt.kind, 'skill');
  assert.equal(receipt.candidateCommit, '');
  assert.equal(receipt.schemaVersion, '');
  assert.ok(receipt.vetoes.includes('slot-plan-origin-mismatch-veto:caller-forged-profile'));
  assert.ok(!receipt.evidenceRefs.includes('extension-profile-plan:caller-forged-profile:caller-forged-signature'));
  assert.ok(receipt.evidenceRefs.some(ref => /^extension-profile-slot-execution:R3-07S-skill-TASK-019:/.test(ref)));
});

test('R3-07S-skill-TASK-020 ExtensionProfilePlanService remembers owner-issued slot attempts without caller replay', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '0123456789abcdef0123456789abcdef01234567',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });

  const first = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-020',
    attemptId: 'skill-task-020-first',
    status: 'failed',
    failureRefs: ['skill-failure:task-020-first'],
  });
  assert.equal(first.status, 'failed');

  const replacementWithoutCallerReplay = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-020',
    attemptId: 'skill-task-020-replacement-without-caller-replay',
    status: 'failed',
    failureRefs: ['skill-failure:task-020-replacement'],
  });

  assert.equal(replacementWithoutCallerReplay.status, 'blocked');
  assert.deepEqual(replacementWithoutCallerReplay.previousAttemptIds, ['skill-task-020-first']);
  assert.ok(replacementWithoutCallerReplay.vetoes.includes('slot-replacement-veto:R3-07S-skill-TASK-020'));
  assert.deepEqual(replacementWithoutCallerReplay.failureRefs, []);
});

function createDeniedEditSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please use react and edit the component',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React',
          '',
          'description: React components',
          'triggers: react',
          'tool_kinds: read, edit',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit'],
  });
}

function createDeniedEditAndTerminalSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please use react, edit the component, and run terminal validation',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React',
          '',
          'description: React components',
          'triggers: react',
          'tool_kinds: read',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit', 'terminal'],
  });
}

function createDeclaredOnlyDeniedEditSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please use react to inspect the component',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React',
          '',
          'description: React components',
          'triggers: react',
          'tool_kinds: read, edit',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read'],
  });
}

function createUnknownRequestedToolSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please use react to inspect the component with sudo access',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React',
          '',
          'description: React components',
          'triggers: react',
          'tool_kinds: read',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'sudo'],
  });
}

function createInvalidDeclaredToolSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please use react and edit the component',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React',
          '',
          'description: React components',
          'triggers: react',
          'tool_kinds: read, sudo',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit'],
  });
}

function createSubstringTriggerDeniedEditSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please build and edit the script',
    candidates: [
      {
        path: 'skills/ui/SKILL.md',
        content: [
          '# UI',
          '',
          'description: UI components',
          'triggers: ui',
          'tool_kinds: read',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit'],
  });
}

function createDuplicatePathDeniedEditSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please use react and edit the component',
    candidates: [
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React',
          '',
          'description: React components',
          'triggers: react',
          'tool_kinds: read',
        ].join('\n'),
      },
      {
        path: 'skills/react/SKILL.md',
        content: [
          '# React Duplicate',
          '',
          'description: React components copy',
          'triggers: react',
          'tool_kinds: read',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit'],
  });
}

function createNoncanonicalPathDeniedEditSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please use react and edit the component',
    candidates: [
      {
        path: 'skills/react/../react/SKILL.md',
        content: [
          '# React',
          '',
          'description: React components',
          'triggers: react',
          'tool_kinds: read',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit'],
  });
}

function createGenericInferredTriggerDeniedEditSkillReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please edit the skill configuration',
    candidates: [
      {
        path: 'skills/deploy/SKILL.md',
        content: [
          '# Deploy',
          '',
          'description: Production release helper',
          'tool_kinds: read',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit'],
  });
}

function createSuffixConfusedSkillPathDeniedEditReceipt() {
  return new SkillDiscoveryService().planExecution({
    prompt: 'please use react and edit the component',
    candidates: [
      {
        path: 'skills/react/NOTSKILL.md',
        content: [
          '# Not A Skill',
          '',
          'description: React components',
          'triggers: react',
          'tool_kinds: read',
        ].join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit'],
  });
}

function createReferenceDeniedEditSkillReceipt(contentLines, prompt = 'please use react and edit the component') {
  return new SkillDiscoveryService().planExecution({
    prompt,
    candidates: [
      {
        path: 'skills/reference/SKILL.md',
        content: contentLines.join('\n'),
      },
    ],
    requestedToolKinds: ['read', 'edit'],
  });
}

function createFencedMetadataDeniedEditSkillReceipt() {
  return createReferenceDeniedEditSkillReceipt([
    '# Reference',
    '',
    'description: Generic helper',
    '',
    '```yaml',
    'triggers: react',
    'tool_kinds: read',
    '```',
  ]);
}

function createCommentedMetadataDeniedEditSkillReceipt() {
  return createReferenceDeniedEditSkillReceipt([
    '# Reference',
    '',
    'description: Generic helper',
    '',
    '<!--',
    'triggers: react',
    'tool_kinds: read',
    '-->',
  ]);
}

function createGenericHelperInferredTriggerDeniedEditSkillReceipt() {
  return createReferenceDeniedEditSkillReceipt([
    '# Reference',
    '',
    'description: Generic helper',
    'tool_kinds: read',
  ], 'please edit the helper configuration');
}

function createBodySectionMetadataDeniedEditSkillReceipt(sectionMarker) {
  return createReferenceDeniedEditSkillReceipt([
    '# Reference',
    '',
    'description: Generic helper',
    '',
    sectionMarker,
    'triggers: react',
    'tool_kinds: read',
  ]);
}

function createClosedFrontmatterBodyMetadataDeniedEditSkillReceipt() {
  return createReferenceDeniedEditSkillReceipt([
    '---',
    'description: Generic helper',
    '---',
    '# Reference',
    '',
    'triggers: react',
    'tool_kinds: read',
  ]);
}

function createUnclosedFrontmatterMetadataDeniedEditSkillReceipt() {
  return createReferenceDeniedEditSkillReceipt([
    '---',
    'description: Generic helper',
    '# Reference',
    '',
    'triggers: react',
    'tool_kinds: read',
  ]);
}

function createGenericActionInferredTriggerDeniedEditSkillReceipt() {
  return createReferenceDeniedEditSkillReceipt([
    '# Reference',
    '',
    'description: Generic helper for edit run test tasks',
    'tool_kinds: read',
  ]);
}

function createInlineHtmlCommentMetadataDeniedEditSkillReceipt() {
  return createReferenceDeniedEditSkillReceipt([
    '# Reference',
    '',
    'description: Generic helper',
    'See details <!--',
    'triggers: react',
    'tool_kinds: read',
    '-->',
  ]);
}

test('R3-07S-skill-PERMISSION-FAULT-001 ExtensionProfilePlanService accepts expected skill permission denial as slot evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1357913579135791357913579135791357913579',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createDeniedEditSkillReceipt();
  assert.ok(childReceipt.violations.includes('skill-tool-kind-denied:edit'));

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-001',
    attemptId: 'skill-permission-fault-001-denied-edit',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.slotKind, 'permission-fault');
  assert.ok(!receipt.vetoes.includes('slot-child-receipt-not-clean-veto:R3-07S-skill-PERMISSION-FAULT-001'));
  assert.deepEqual(receipt.childViolations, ['skill-tool-kind-denied:edit']);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
  assert.match(receipt.permissionFaultRefs[0], /^extension-profile-slot-permission-fault:R3-07S-skill-PERMISSION-FAULT-001:/);
  assert.ok(receipt.evidenceRefs.includes(receipt.permissionFaultRefs[0]));
});

test('R3-07S-skill-PERMISSION-FAULT-002 ExtensionProfilePlanService rejects reused permission fault evidence across slots', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '2468024680246802468024680246802468024680',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createDeniedEditSkillReceipt();

  const first = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-001',
    attemptId: 'skill-permission-fault-002-first-denied-edit',
    status: 'passed',
    childReceipt,
  });
  assert.equal(first.status, 'passed');

  const reused = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-002',
    attemptId: 'skill-permission-fault-002-reused-denied-edit',
    status: 'passed',
    childReceipt,
  });

  assert.equal(reused.status, 'blocked');
  assert.ok(reused.vetoes.includes('slot-permission-fault-evidence-reuse-veto:R3-07S-skill-PERMISSION-FAULT-002'));
  assert.deepEqual(reused.permissionFaultRefs, []);
  assert.deepEqual(reused.effectRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-003 ExtensionProfilePlanService rejects ambiguous multi-denial permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '3691215182124273033363942454851545759606',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createDeniedEditAndTerminalSkillReceipt();
  assert.ok(childReceipt.violations.includes('skill-tool-kind-denied:edit'));
  assert.ok(childReceipt.violations.includes('skill-tool-kind-denied:terminal'));

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-003',
    attemptId: 'skill-permission-fault-003-ambiguous-denial',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.ok(receipt.vetoes.includes('slot-child-permission-fault-ambiguous-veto:R3-07S-skill-PERMISSION-FAULT-003'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-004 ExtensionProfilePlanService keeps permission fault evidence parent-owned', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '4812162024283236404448525660646872768084',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-004',
    attemptId: 'skill-permission-fault-004-parent-owned-evidence',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'passed');
  assert.ok(receipt.childEvidenceRefs.some(ref => ref.startsWith('skill:')));
  assert.match(receipt.permissionFaultRefs[0], /^extension-profile-slot-permission-fault:R3-07S-skill-PERMISSION-FAULT-004:/);
  assert.ok(receipt.evidenceRefs.includes(receipt.permissionFaultRefs[0]));
  assert.equal(receipt.evidenceRefs.some(ref => ref.startsWith('skill:')), false);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-005 ExtensionProfilePlanService rejects unrequested permission fault denial evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '5101520253035404550556065707580859095100',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createDeclaredOnlyDeniedEditSkillReceipt();
  assert.ok(childReceipt.violations.includes('skill-tool-kind-denied:edit'));

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-005',
    attemptId: 'skill-permission-fault-005-unrequested-denial',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.ok(receipt.vetoes.includes('slot-child-permission-fault-unrequested-veto:R3-07S-skill-PERMISSION-FAULT-005'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-006 ExtensionProfilePlanService rejects unknown requested tool permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '6121824303642485460667284900214263840420',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createUnknownRequestedToolSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-006',
    attemptId: 'skill-permission-fault-006-unknown-requested-tool',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.deepEqual(childReceipt.requestedToolKinds, ['read']);
  assert.ok(childReceipt.violations.includes('skill-tool-kind-invalid:sudo'));
  assert.equal(childReceipt.violations.includes('skill-tool-kind-denied:sudo'), false);
  assert.ok(receipt.vetoes.includes('slot-child-receipt-not-clean-veto:R3-07S-skill-PERMISSION-FAULT-006'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-007 ExtensionProfilePlanService rejects invalid declared tool permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '7142128354249566370778491980516273849506',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createInvalidDeclaredToolSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-007',
    attemptId: 'skill-permission-fault-007-invalid-declared-tool',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.deepEqual(childReceipt.loadedSkills[0].declaredToolKinds, ['read']);
  assert.ok(childReceipt.violations.includes('skill-tool-kind-invalid:sudo'));
  assert.ok(childReceipt.violations.includes('skill-tool-kind-denied:edit'));
  assert.ok(receipt.vetoes.includes('slot-child-receipt-not-clean-veto:R3-07S-skill-PERMISSION-FAULT-007'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-008 ExtensionProfilePlanService rejects substring trigger permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '8162432404856647280880416283244860728496',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createSubstringTriggerDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-008',
    attemptId: 'skill-permission-fault-008-substring-trigger',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-008'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-009 ExtensionProfilePlanService rejects duplicate skill path permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '9182736455463728190019283746554637281900',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createDuplicatePathDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-009',
    attemptId: 'skill-permission-fault-009-duplicate-skill-path',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 2);
  assert.ok(childReceipt.violations.includes('skill-path-collision:skills/react/SKILL.md'));
  assert.ok(childReceipt.violations.includes('skill-tool-kind-denied:edit'));
  assert.ok(receipt.vetoes.includes('slot-child-receipt-not-clean-veto:R3-07S-skill-PERMISSION-FAULT-009'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-010 ExtensionProfilePlanService rejects noncanonical skill path permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1029384756657483920110293847566574839201',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createNoncanonicalPathDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-010',
    attemptId: 'skill-permission-fault-010-noncanonical-skill-path',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 1);
  assert.ok(childReceipt.violations.includes('skill-path-noncanonical:skills/react/../react/SKILL.md'));
  assert.ok(childReceipt.violations.includes('skill-tool-kind-denied:edit'));
  assert.ok(receipt.vetoes.includes('slot-child-receipt-not-clean-veto:R3-07S-skill-PERMISSION-FAULT-010'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-011 ExtensionProfilePlanService rejects generic inferred trigger permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1122334455667788990011223344556677889900',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createGenericInferredTriggerDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-011',
    attemptId: 'skill-permission-fault-011-generic-inferred-trigger',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-011'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-012 ExtensionProfilePlanService rejects suffix-confused skill file permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1212121212121212121212121212121212121212',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createSuffixConfusedSkillPathDeniedEditReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-012',
    attemptId: 'skill-permission-fault-012-suffix-confused-skill-file',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-012'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-013 ExtensionProfilePlanService rejects fenced skill metadata permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1313131313131313131313131313131313131313',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createFencedMetadataDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-013',
    attemptId: 'skill-permission-fault-013-fenced-skill-metadata',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-013'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-014 ExtensionProfilePlanService rejects commented skill metadata permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1414141414141414141414141414141414141414',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createCommentedMetadataDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-014',
    attemptId: 'skill-permission-fault-014-commented-skill-metadata',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-014'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-015 ExtensionProfilePlanService rejects generic helper inferred trigger permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1515151515151515151515151515151515151515',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createGenericHelperInferredTriggerDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-015',
    attemptId: 'skill-permission-fault-015-generic-helper-inferred-trigger',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-015'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-016 ExtensionProfilePlanService rejects example skill metadata permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1616161616161616161616161616161616161616',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createBodySectionMetadataDeniedEditSkillReceipt('Example:');

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-016',
    attemptId: 'skill-permission-fault-016-example-skill-metadata',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-016'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-017 ExtensionProfilePlanService rejects natural-language example skill metadata permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1717171717171717171717171717171717171717',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createBodySectionMetadataDeniedEditSkillReceipt('For example:');

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-017',
    attemptId: 'skill-permission-fault-017-natural-example-skill-metadata',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-017'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-018 ExtensionProfilePlanService rejects bare example heading skill metadata permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1818181818181818181818181818181818181818',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createBodySectionMetadataDeniedEditSkillReceipt('Examples');

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-018',
    attemptId: 'skill-permission-fault-018-bare-example-heading-skill-metadata',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-018'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-019 ExtensionProfilePlanService rejects closed frontmatter body skill metadata permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '1919191919191919191919191919191919191919',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createClosedFrontmatterBodyMetadataDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-019',
    attemptId: 'skill-permission-fault-019-closed-frontmatter-body-skill-metadata',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-019'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-020 ExtensionProfilePlanService rejects unclosed frontmatter skill metadata permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '2020202020202020202020202020202020202020',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createUnclosedFrontmatterMetadataDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-020',
    attemptId: 'skill-permission-fault-020-unclosed-frontmatter-skill-metadata',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-020'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-021 ExtensionProfilePlanService rejects generic action inferred trigger permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '2121212121212121212121212121212121212121',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createGenericActionInferredTriggerDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-021',
    attemptId: 'skill-permission-fault-021-generic-action-inferred-trigger',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-021'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
});

test('R3-07S-skill-PERMISSION-FAULT-022 ExtensionProfilePlanService rejects inline HTML comment skill metadata permission fault evidence', () => {
  const service = new ExtensionProfilePlanService();
  const plan = service.createProfilePlan({
    kind: 'skill',
    candidateCommit: '2222222222222222222222222222222222222222',
    schemaVersion: SKILL_EXECUTION_PROTOCOL,
  });
  const childReceipt = createInlineHtmlCommentMetadataDeniedEditSkillReceipt();

  const receipt = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-PERMISSION-FAULT-022',
    attemptId: 'skill-permission-fault-022-inline-html-comment-skill-metadata',
    status: 'passed',
    childReceipt,
  });

  assert.equal(receipt.status, 'blocked');
  assert.equal(childReceipt.loadedSkills.length, 0);
  assert.ok(childReceipt.blockedReasons.includes('unmatched-skill-not-loaded'));
  assert.deepEqual(childReceipt.evidenceRefs, []);
  assert.ok(receipt.vetoes.includes('slot-child-evidence-missing-veto:R3-07S-skill-PERMISSION-FAULT-022'));
  assert.deepEqual(receipt.permissionFaultRefs, []);
  assert.deepEqual(receipt.effectRefs, []);
  assert.deepEqual(receipt.receiptRefs, []);
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

test('R3-07D PluginSupplyChainService rejects unsigned tampered stale revoked and unsafe plugin updates', () => {
  const service = new PluginSupplyChainService();
  const receipt = service.evaluate({
    approvedManifests: [
      { id: 'signed-plugin', version: '1.2.0', manifestDigest: 'sha256:signed', signature: 'sig:signed' },
      { id: 'tampered-plugin', version: '2.0.0', manifestDigest: 'sha256:expected', signature: 'sig:tampered' },
      { id: 'stale-plugin', version: '0.9.0', manifestDigest: 'sha256:stale', signature: 'sig:stale' },
      { id: 'revoked-plugin', version: '1.0.0', manifestDigest: 'sha256:revoked', signature: 'sig:revoked' },
      { id: 'dep-plugin', version: '1.0.0', manifestDigest: 'sha256:dep', signature: 'sig:dep' },
      { id: 'downgrade-plugin', version: '1.0.0', manifestDigest: 'sha256:downgrade', signature: 'sig:downgrade' },
    ],
    minimumVersions: {
      'stale-plugin': '1.0.0',
    },
    revokedPlugins: [
      { id: 'revoked-plugin', version: '1.0.0' },
    ],
    allowedDependencies: {
      'signed-plugin': ['safe-dep@1.0.0'],
      'dep-plugin': ['safe-dep@1.0.0'],
    },
    manifests: [
      {
        id: 'signed-plugin',
        version: '1.2.0',
        manifestDigest: 'sha256:signed',
        signature: 'sig:signed',
        dependencies: ['safe-dep@1.0.0'],
        updateFromVersion: '1.1.0',
      },
      {
        id: 'unsigned-plugin',
        version: '1.0.0',
        manifestDigest: 'sha256:unsigned',
      },
      {
        id: 'tampered-plugin',
        version: '2.0.0',
        manifestDigest: 'sha256:actual',
        signature: 'sig:tampered',
      },
      {
        id: 'stale-plugin',
        version: '0.9.0',
        manifestDigest: 'sha256:stale',
        signature: 'sig:stale',
      },
      {
        id: 'revoked-plugin',
        version: '1.0.0',
        manifestDigest: 'sha256:revoked',
        signature: 'sig:revoked',
      },
      {
        id: 'dep-plugin',
        version: '1.0.0',
        manifestDigest: 'sha256:dep',
        signature: 'sig:dep',
        dependencies: ['unknown-dep@1.0.0'],
      },
      {
        id: 'downgrade-plugin',
        version: '1.0.0',
        manifestDigest: 'sha256:downgrade',
        signature: 'sig:downgrade',
        updateFromVersion: '2.0.0',
      },
    ],
  });

  assert.equal(receipt.protocol, 'devseek.plugin-supply-chain/v1');
  assert.equal(receipt.settlementAuthority, 'parent-kernel');
  assert.equal(receipt.effectAuthority, 'B4-effect-authority');
  assert.equal(receipt.singleOwner, 'PluginSupplyChainService');
  assert.equal(receipt.decisions.find(decision => decision.plugin === 'signed-plugin@1.2.0')?.action, 'allow');
  assert.equal(receipt.decisions.find(decision => decision.plugin === 'unsigned-plugin@1.0.0')?.action, 'veto');
  assert.equal(receipt.decisions.find(decision => decision.plugin === 'tampered-plugin@2.0.0')?.action, 'veto');
  assert.equal(receipt.decisions.find(decision => decision.plugin === 'stale-plugin@0.9.0')?.action, 'veto');
  assert.equal(receipt.decisions.find(decision => decision.plugin === 'revoked-plugin@1.0.0')?.action, 'veto');
  assert.equal(receipt.decisions.find(decision => decision.plugin === 'dep-plugin@1.0.0')?.action, 'veto');
  assert.equal(receipt.decisions.find(decision => decision.plugin === 'downgrade-plugin@1.0.0')?.action, 'veto');
  assert.ok(receipt.vetoes.includes('plugin-unsigned-veto:unsigned-plugin@1.0.0'));
  assert.ok(receipt.vetoes.includes('plugin-tampered-veto:tampered-plugin@2.0.0'));
  assert.ok(receipt.vetoes.includes('plugin-stale-version-veto:stale-plugin@0.9.0'));
  assert.ok(receipt.vetoes.includes('plugin-revoked-veto:revoked-plugin@1.0.0'));
  assert.ok(receipt.vetoes.includes('plugin-dependency-veto:dep-plugin@1.0.0->unknown-dep@1.0.0'));
  assert.ok(receipt.vetoes.includes('plugin-downgrade-update-veto:downgrade-plugin@1.0.0'));
  assert.ok(receipt.evidenceRefs.some(ref => ref.startsWith('plugin-manifest:signed-plugin@1.2.0:')));
});
