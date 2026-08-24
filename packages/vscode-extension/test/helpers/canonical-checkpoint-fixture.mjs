import {
  CanonicalCheckpointService,
  CanonicalContextGraphService,
  CanonicalMemoryPolicyService,
  buildCodingKernelTaskContract,
} from '../../../shared/dist/index.js';

export function createCanonicalTaskContractFixture({
  userPrompt = 'finish the task',
  mode = 'change',
  contextFiles = [],
} = {}) {
  return buildCodingKernelTaskContract({
    goal: userPrompt,
    mode,
    include: contextFiles,
    deliverables: [{ id: 'result', kind: mode === 'review' ? 'report' : 'source-change' }],
    acceptance: [{
      id: 'completed',
      statement: 'The requested work is complete.',
      deliverableIds: ['result'],
      oracle: {
        kind: mode === 'review' ? 'response-evidence' : 'verification',
        verifier: 'checkpoint-fixture-adapter',
        scope: contextFiles.length > 0 ? contextFiles : ['workspace'],
        evidenceKinds: [mode === 'review' ? 'response-evidence' : 'verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['checkpoint-fixture'],
  });
}

export function createCanonicalCheckpointFixture({
  tasks,
  startFromIndex = 0,
  completedUnitCount = startFromIndex,
  workspaceRoot = '/workspace',
  runId = 'checkpoint-fixture-run',
  surface = 'vscode',
  userPrompt = 'finish the task',
  mode = 'change',
  contextFiles = [],
  contextSeed = { files: contextFiles.map(path => ({ path })) },
  taskContract = createCanonicalTaskContractFixture({ userPrompt, mode, contextFiles }),
  contextGraph = new CanonicalContextGraphService().build({
    workspaceRoot,
    userPrompt,
    taskContract,
    seed: contextSeed,
  }),
  memoryPolicySha256 = new CanonicalMemoryPolicyService().selectContext({
    candidates: [],
    workspaceRoot,
  }).decisionSha256,
  reason = 'paused',
  epoch = 1,
  evidenceRefs = [],
} = {}) {
  const pendingTasks = tasks.slice(startFromIndex);
  return new CanonicalCheckpointService().bind({
    runId,
    surface,
    workspaceRoot,
    taskContract,
    contextGraph,
    memoryPolicySha256,
  }).create({
    epoch,
    completedUnitCount,
    pendingUnits: pendingTasks.map((task, index) => ({
      id: taskId(task, startFromIndex + index),
      description: taskDescription(task, startFromIndex + index),
      ...(typeof task?.action === 'string' && task.action.trim() ? { action: task.action } : {}),
      ...(taskTarget(task) ? { target: taskTarget(task) } : {}),
    })),
    reason,
    evidenceRefs,
  });
}

function taskId(task, index) {
  return typeof task?.id === 'string' && task.id.trim() ? task.id.trim() : `task-${index + 1}`;
}

function taskDescription(task, index) {
  for (const value of [task?.desc, task?.title, task?.description]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return `pending task ${index + 1}`;
}

function taskTarget(task) {
  for (const value of [task?.visibleTarget, task?.file]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
