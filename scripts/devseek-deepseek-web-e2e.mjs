#!/usr/bin/env node
if (!process.argv.includes('--real-bridge')) process.argv.push('--real-bridge');
await import('../packages/vscode-extension/test/devseek-human-input-harness.mjs');
