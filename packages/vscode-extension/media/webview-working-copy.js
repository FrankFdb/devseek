// Working-area copy strategy helpers for the DevSeek webview.
// Loaded before webview.js; does not own webview state.

const WORKING_COPY_STRATEGY_TABLE = {
  concise: {
    stageRunning: function(phaseLabel) {
      return '正在处理：' + phaseLabel;
    },
    stageVerb: function(state) {
      if (state === 'passed') return '通过';
      if (state === 'failed') return '失败';
      if (state === 'completed') return '完成';
      if (state === 'skipped') return '跳过';
      return '进行中';
    },
    buildDetail: function(phase, state, detail) {
      if (detail && phase !== 'validate') return detail;
      if (phase === 'apply' && state === 'completed') return '文件已应用。';
      if (phase === 'validate' && state === 'started') return '正在验证修改结果…';
      if (phase === 'validate' && state === 'passed') return '验证通过。';
      if (phase === 'validate' && state === 'failed') return '验证失败。';
      if (phase === 'repair' && (state === 'completed' || state === 'passed')) return '修复完成。';
      if (phase === 'repair' && state === 'failed') return '修复失败。';
      return '';
    },
    idleSummary: function(running) {
      return running ? '过程临时展示，结束后自动收敛。' : '本轮过程已收敛。';
    },
    finishedSummary: function(stats, count, hasArtifacts, hasRaw) {
      var base = '阶段：完成 ' + stats.passed + '，失败 ' + stats.failed + '。';
      if (hasArtifacts) return base + ' 识别到 ' + count + ' 个文件变更。';
      if (hasRaw) return base + ' 已输出结果。';
      return base + ' 无可继续处理输出。';
    },
    failureSummary: function() {
      return '执行失败，请重试或调整提示词。';
    },
  },
  detailed: {
    stageRunning: function(phaseLabel) {
      return '正在处理：' + phaseLabel;
    },
    stageVerb: function(state) {
      if (state === 'passed') return '已通过';
      if (state === 'failed') return '未通过';
      if (state === 'completed') return '已完成';
      if (state === 'skipped') return '已跳过';
      return '进行中';
    },
    buildDetail: function(phase, state, detail) {
      if (detail && phase !== 'validate') return detail;
      if (phase === 'apply') {
        if (state === 'started') return '正在应用文件修改…';
        if (state === 'completed') return '文件修改已应用。';
        if (state === 'failed') return '文件应用失败。';
      }
      if (phase === 'validate') {
        if (state === 'started') return '正在验证修改结果…';
        if (state === 'passed') return '验证通过。';
        if (state === 'failed') return '验证失败。';
        if (state === 'skipped') return '未执行自动验证。';
      }
      if (phase === 'repair') {
        if (state === 'started') return '正在执行自动修复…';
        if (state === 'completed' || state === 'passed') return '自动修复完成。';
        if (state === 'failed') return '自动修复未通过。';
      }
      return '';
    },
    idleSummary: function(running) {
      return running ? '动态过程临时显示，结束后自动收敛。' : '本轮过程已收敛，可继续下一轮提问。';
    },
    finishedSummary: function(stats, count, hasArtifacts, hasRaw) {
      var stageSummary = '阶段结果：完成 ' + stats.passed + '，失败 ' + stats.failed + '，跳过 ' + stats.skipped + '。';
      if (hasArtifacts) return stageSummary + ' 已识别 ' + count + ' 个文件变更，建议先逐文件对比，再按文件或批量应用。';
      if (hasRaw) return stageSummary + ' 结果已写入主消息区，可继续追问细化，或发起下一轮任务。';
      return stageSummary + ' 当前没有可继续处理的输出。';
    },
    failureSummary: function() {
      return '本轮执行失败：请查看错误信息并决定重试、调整提示词或终止。';
    },
  },
};

function normalizeWorkingCopyStyle(style) {
  return style === 'concise' ? 'concise' : 'detailed';
}
