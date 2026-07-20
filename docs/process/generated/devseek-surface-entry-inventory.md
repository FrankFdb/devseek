# DevSeek Surface Entry Inventory

- inventory_id: `DEVSEEK-R1-D1A-SURFACE-ENTRY-INVENTORY/v1`
- inventory_sha256: `9b9ca89f1cd7e6cbba68df0da610aecb73c25a36e08bd7bc9855f5d3802a3380`
- qualification_effect: `NONE`
- claims_permitted: `false`
- asserts_gate_pass: `false`

## Counts

| Metric | Count |
| --- | ---: |
| total_entries | 84 |
| vscode_manifest_commands | 16 |
| vscode_runtime_commands | 22 |
| vscode_manifest_commands_missing_runtime | 0 |
| vscode_public_runtime_without_manifest | 0 |
| webview_protocol_entries | 41 |
| webview_handler_entries | 41 |
| webview_protocol_missing_handler | 0 |
| webview_handler_missing_protocol | 0 |
| attachment_entries | 5 |
| cli_entrypoints | 8 |
| bridge_endpoints | 10 |
| unknown_entries | 0 |
| duplicate_surface_entry_ids | 0 |
| declared_adapter_pending_cutover | 0 |
| undeclared_legacy_owner_reachability | 0 |
| duplicate_manifest_command_declarations | 0 |
| duplicate_runtime_command_registrations | 0 |
| duplicate_webview_protocol_declarations | 0 |
| duplicate_webview_handler_registrations | 0 |

## Entries

| Entry | Surface | Kind | Scope | Source | Coverage | Projection |
| --- | --- | --- | --- | --- | --- | --- |
| `attachment/bridge-preattach` | bridge-attachment | bridge-endpoint | local-public | `packages/bridge/src/server.ts` | covered | ContextRef |
| `attachment/vscode-command-add-file-to-chat` | vscode | attachment-command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | ContextRef |
| `attachment/webview-chat-files` | vscode-webview | attachment-message-field | public | `packages/vscode-extension/src/ui/webview-protocol.ts` | covered | ContextRef |
| `attachment/webview-chat-images` | vscode-webview | attachment-message-field | public | `packages/vscode-extension/src/ui/webview-protocol.ts` | covered | ContextRef |
| `bridge/get-:index:file` | bridge-context-index | http-endpoint | local-public | `packages/bridge/src/server.ts` | covered | context-ref-read |
| `bridge/get-:index:search` | bridge-context-index | http-endpoint | local-public | `packages/bridge/src/server.ts` | covered | context-ref-search |
| `bridge/get-:ping` | bridge-health | http-endpoint | local-public | `packages/bridge/src/server.ts` | covered | health-read |
| `bridge/get-:status` | bridge-status | http-endpoint | local-public | `packages/bridge/src/server.ts` | covered | status-read |
| `bridge/post-:cancel` | bridge-control | http-endpoint | local-public | `packages/bridge/src/server.ts` | covered | agent-cancel |
| `bridge/post-:chat` | bridge-provider-transport | http-endpoint | local-public | `packages/bridge/src/server.ts` | covered | agent-command-provider-transport |
| `bridge/post-:preattach` | bridge-attachment | http-endpoint | local-public | `packages/bridge/src/server.ts` | covered | context-ref-preattach |
| `bridge/post-:relogin` | bridge-auth | http-endpoint | local-public | `packages/bridge/src/server.ts` | covered | auth-session-action |
| `bridge/post-:shutdown` | bridge-control | http-endpoint | internal-control | `packages/bridge/src/server.ts` | covered | lifecycle-control |
| `cli/bin-devseek` | cli | binary-entrypoint | public | `packages/cli/package.json` | covered | binary-to-cli-surface |
| `cli/exec` | cli | cli-entrypoint | cli-exec | `packages/cli/src/index.ts` | covered | AgentCommand/Event |
| `cli/help` | cli | cli-entrypoint | cli-help | `packages/cli/src/index.ts` | covered | help-text |
| `cli/interactive` | cli | cli-entrypoint | cli-interactive | `packages/cli/src/index.ts` | covered | AgentCommand/Event |
| `cli/jsonl-exec` | cli | cli-entrypoint | jsonl | `packages/cli/src/index.ts` | covered | AgentEvent JSONL |
| `cli/mock-exec` | cli | cli-entrypoint | cli-test | `packages/cli/src/index.ts` | covered | local-mock-provider |
| `cli/resume-exec` | cli | cli-entrypoint | cli-resume | `packages/cli/src/index.ts` | covered | AgentCommand/Event |
| `cli/version` | cli | cli-entrypoint | cli-version | `packages/cli/src/index.ts` | covered | version-text |
| `vscode-command/_deepseek.askChat` | vscode | command | internal | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | chat-relay-internal |
| `vscode-command/_devseek.diffKeepHunk` | vscode | command | internal | `packages/vscode-extension/src/pending-edit-coordinator.ts` | covered | pending-edit-action |
| `vscode-command/_devseek.diffUndoHunk` | vscode | command | internal | `packages/vscode-extension/src/pending-edit-coordinator.ts` | covered | pending-edit-action |
| `vscode-command/_devseek.harnessRunChat` | vscode | command | test-only | `packages/vscode-extension/src/ui/real-plugin-harness.ts` | covered | test-only-controlled-surface |
| `vscode-command/_devseek.harnessSubmitChatMessage` | vscode | command | test-only | `packages/vscode-extension/src/ui/real-plugin-harness.ts` | covered | test-only-controlled-surface |
| `vscode-command/devseek.addFileToChat` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | ContextRef |
| `vscode-command/devseek.applyDiff` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.ask` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.explain` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.fix` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.genDoc` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.generateCommit` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.genTest` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.inlineChat` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.keepOrUndoActive` | vscode | command | hidden-statusbar | `packages/vscode-extension/src/pending-edit-coordinator.ts` | covered | pending-edit-action |
| `vscode-command/devseek.openChat` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | surface-ui-action |
| `vscode-command/devseek.refactor` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.runTerminalCommand` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.runTests` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | AgentCommand/Event |
| `vscode-command/devseek.showMemoryFiles` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | ContextRef |
| `vscode-command/devseek.switchProvider` | vscode | command | public | `packages/vscode-extension/src/llm/provider-router.ts` | covered | provider-config-action |
| `vscode-command/devseek.triggerCompletion` | vscode | command | public | `packages/vscode-extension/src/ui/extension-command-registration.ts` | covered | surface-ui-action |
| `vscode-webview/agentSteer` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | AgentSteer |
| `vscode-webview/agentToggle` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/applyGeneratedFiles` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | generated-artifact-action |
| `vscode-webview/applyGeneratedPath` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | generated-artifact-action |
| `vscode-webview/archiveTask` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | task-history-action |
| `vscode-webview/cancel` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/chat` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | AgentCommand/Event |
| `vscode-webview/clearContext` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/clearHistory` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/continueTask` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | task-history-action |
| `vscode-webview/deleteSession` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/deleteTask` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | task-history-action |
| `vscode-webview/dismissAgentCheckpoint` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | checkpoint-action |
| `vscode-webview/exportTask` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | task-history-action |
| `vscode-webview/getProblems` | vscode-webview | webview-inbound-message | ui-read | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/getStatus` | vscode-webview | webview-inbound-message | ui-read | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/insertCode` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/keepAllPendingEdits` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | pending-edit-action |
| `vscode-webview/keepPendingEdit` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | pending-edit-action |
| `vscode-webview/keepPendingHunk` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | pending-edit-action |
| `vscode-webview/listSessions` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/listTasks` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | task-history-action |
| `vscode-webview/loadSession` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/openGeneratedPath` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | generated-artifact-action |
| `vscode-webview/openPendingEdit` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | pending-edit-action |
| `vscode-webview/openTask` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | task-history-action |
| `vscode-webview/previewGeneratedFiles` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | generated-artifact-action |
| `vscode-webview/previewGeneratedPath` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | generated-artifact-action |
| `vscode-webview/ready` | vscode-webview | webview-inbound-message | ui-read | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/relogin` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/resolveFile` | vscode-webview | webview-inbound-message | ui-read | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/resumeAgentCheckpoint` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | checkpoint-action |
| `vscode-webview/runCommand` | vscode-webview | webview-inbound-message | disabled-generic-command | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | disabled-generic-command |
| `vscode-webview/runInVsTerminal` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/saveSession` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/setAutopilot` | vscode-webview | webview-inbound-message | public | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/setMode` | vscode-webview | webview-inbound-message | ui-read | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/terminalConfirmReply` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | typed-webview-action |
| `vscode-webview/undoAllPendingEdits` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | pending-edit-action |
| `vscode-webview/undoPendingEdit` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | pending-edit-action |
| `vscode-webview/undoPendingHunk` | vscode-webview | webview-inbound-message | ui-action | `packages/vscode-extension/src/ui/deepseek-view-provider.ts` | covered | pending-edit-action |

