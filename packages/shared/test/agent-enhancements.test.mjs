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
  assert.deepEqual(receipt.effectRefs, ['skill-discovery:read:SKILL.md']);
  assert.deepEqual(receipt.receiptRefs, ['skill-execution:receipt:task-001']);
  assert.ok(receipt.evidenceRefs.includes(plan.taskSlots[0].oracleRef));

  const failed = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-001',
    attemptId: 'skill-task-001-attempt-failed',
    status: 'failed',
    failureRefs: ['skill-execution:failure:task-001'],
  });
  const replacement = service.recordSlotExecution({
    plan,
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
  assert.deepEqual(failed.failureRefs, ['skill-execution:failure:task-005']);
  assert.deepEqual(failed.effectRefs, []);
  assert.deepEqual(failed.receiptRefs, []);
  assert.ok(failed.evidenceRefs.includes('skill-execution:failure:task-005'));
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
  assert.deepEqual(vetoed.vetoes, ['skill-policy:veto:task-006']);
  assert.deepEqual(vetoed.effectRefs, []);
  assert.deepEqual(vetoed.receiptRefs, []);
  assert.ok(vetoed.evidenceRefs.includes('skill-policy:veto:task-006'));
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
  assert.ok(passedWithVeto.vetoes.includes('skill-policy:unexpected-veto-on-pass'));
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
  assert.ok(failed.evidenceRefs.includes('skill-execution:failure:task-007'));
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

  const vetoed = service.recordSlotExecution({
    plan,
    slotId: 'R3-07S-skill-TASK-007',
    attemptId: 'skill-task-007-vetoed',
    status: 'vetoed',
    childReceipt: dirtyChildReceipt,
    vetoes: ['skill-policy:veto:task-007'],
  });
  assert.equal(vetoed.status, 'vetoed');
  assert.deepEqual(vetoed.childEvidenceRefs, []);
  assert.deepEqual(vetoed.childViolations, []);
  assert.ok(vetoed.evidenceRefs.includes('skill-policy:veto:task-007'));
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
  assert.ok(invalidStatus.vetoes.includes('skill-policy:invalid-status-extra-veto'));
  assert.ok(invalidStatus.evidenceRefs.includes('slot-invalid-status-veto:R3-07S-skill-TASK-008'));
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

  const failed = service.recordSlotExecution({
    plan,
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
  assert.deepEqual(failed.failureRefs, ['skill-failure:task-010']);
  assert.ok(!failed.evidenceRefs.includes('skill-child:evidence:should-not-project-failed'));
  assert.ok(!failed.evidenceRefs.includes('skill-child:violation:should-not-project-failed'));

  const blockedByChild = service.recordSlotExecution({
    plan,
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
