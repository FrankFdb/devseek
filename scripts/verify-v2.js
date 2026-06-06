#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const extDir = path.join(__dirname, '../packages/vscode-extension');

const dist = fs.readFileSync(path.join(extDir, 'dist/extension.js'), 'utf8');

// Extract manifest from vsix (zip) using unzip -p
const { execSync } = require('child_process');
const vsixPath2 = path.join(extDir, 'deepseek-netai-0.2.0.vsix');
let manifest = '';
try {
  manifest = execSync('unzip -p "' + vsixPath2 + '" extension.vsixmanifest 2>/dev/null').toString();
} catch (e) {
  manifest = '';
}

let pass = 0, fail = 0;
function check(name, result) {
  const ok = !!result;
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
}

// --- Bundle (runtime) checks ---
const slashCmds = ['/explain', '/fix', '/refactor', '/tests', '/doc', '/commit', '/shell'];
for (const c of slashCmds) {
  check('slash cmd in bundle: ' + c, dist.includes(c));
}

check('runCommand case in bundle',          dist.includes('runCommand'));
check('getProblems case in bundle',         dist.includes('getProblems'));
check('resolveFile case in bundle',         dist.includes('resolveFile'));
check('Ghost Text (InlineCompletion)',      dist.includes('InlineCompletionItemProvider'));
check('suggest-popup in HTML',             dist.includes('suggest-popup'));
check('showSuggest in bundle',             dist.includes('showSuggest'));
check('hideSuggest in bundle',             dist.includes('hideSuggest'));
check('moveSuggest in bundle',             dist.includes('moveSuggest'));
check('completeSuggest in bundle',         dist.includes('completeSuggest'));
check('@file resolveFile routing',         dist.includes('resolveFile'));
check('#problems routing',                 dist.includes('#problems'));
check('/shell prompt injection',           dist.includes('Shell'));
check('buildCompletionPrompt call',        dist.includes('buildCompletionPrompt'));
check('buildInlineChatPrompt call',        dist.includes('buildInlineChatPrompt'));
check('buildCommitPrompt call',            dist.includes('buildCommitPrompt'));
check('getProblemsContext call',           dist.includes('getProblemsContext'));
check('readWorkspaceFile call',            dist.includes('readWorkspaceFile'));
check('generateCommitMessage registered',  dist.includes('generateCommitMessage'));
check('deepseek.inlineChat registered',    dist.includes('deepseek.inlineChat'));
check('deepseek.generateCommit registered',dist.includes('deepseek.generateCommit'));
check('deepseek.applyDiff registered',     dist.includes('deepseek.applyDiff'));

// --- vsix manifest version ---
const identVerMatch = manifest.match(/Identity[^>]*Version="([^"]+)"/);
check('vsixmanifest identity version = 0.2.0', identVerMatch && identVerMatch[1] === '0.2.0');

// --- package.json version ---
const pkg = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8'));
check('package.json version = 0.2.0',      pkg.version === '0.2.0');
check('completionEnabled config key',      JSON.stringify(pkg.contributes.configuration.properties).includes('completionEnabled'));
check('completionTriggerDelay config key', JSON.stringify(pkg.contributes.configuration.properties).includes('completionTriggerDelay'));
check('contextTokenBudget config key',     JSON.stringify(pkg.contributes.configuration.properties).includes('contextTokenBudget'));
check('deepseek.inlineChat in commands',   JSON.stringify(pkg.contributes.commands).includes('deepseek.inlineChat'));
check('deepseek.generateCommit in cmds',   JSON.stringify(pkg.contributes.commands).includes('deepseek.generateCommit'));
check('Ctrl+I keybinding',                 JSON.stringify(pkg.contributes.keybindings).includes('ctrl+i'));
check('Alt+\\ keybinding',                 JSON.stringify(pkg.contributes.keybindings).includes('alt+\\\\'));
check('generateCommit in scm/title menu',  JSON.stringify(pkg.contributes.menus).includes('scm/title'));

// --- vsix file exists ---
const vsixPath = path.join(extDir, 'deepseek-netai-0.2.0.vsix');
check('deepseek-netai-0.2.0.vsix exists',  fs.existsSync(vsixPath));

const vsixSize = fs.statSync(vsixPath).size;
check('vsix size > 10KB',                  vsixSize > 10240);

console.log('');
console.log('=============================================');
console.log('PASS: ' + pass + '/' + (pass+fail));
if (fail > 0) {
  console.log('FAIL: ' + fail + '  <-- items above show FAIL');
  process.exit(1);
} else {
  console.log('ALL PASS - Phase 3 closed-loop verification OK');
}
