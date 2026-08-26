# N4 C++ Visual Math Pause Checkpoint

## Candidate

- Source: `devseek-multi/2ffac6f68207d3248226eea0b2aa9bd48cba3738`
- VSIX: `devseek-netai-2.0.32-debug.20260826.t133847.g2ffac6f.vsix`
- SHA-256: `f0cdd5b8dee5ef91d8b22c7b2bb9210cbc4d24739be70dc9e5697fdb86ddd37b`
- Local install identity: `devseek-netai.devseek-netai@2.0.32-debug.20260826.t133847.g2ffac6f`
- Focused tests: 170/170 passed
- Shared tests: 369/369 passed
- Extension full test entry: passed with zero failures
- TypeScript typecheck, extension compile, and architecture drift: passed

This debug candidate is `paused_revalidation_required`. It has not completed
the four-round live Provider journey and is not a protected or qualified RC.

## What This Iteration Fixed

The failed live journey exposed a model-session responsibility defect rather
than a C++-specific case:

1. A quarantined Provider response can rebuild the model session without
   pretending that previously read file contents are still present.
2. Read audit paths remain durable, while context duplicate suppression is
   reset only for the rebuilt model session so necessary files can be replayed
   once.
3. Claude-style `execute_command` text is normalized through the canonical
   `run_terminal` schema and still passes through DevSeek's local permission,
   sandbox, and effect arbitration.
4. The journey protects `CMakeLists.txt`, `test.sh`, `USER_STORY.md`, and
   `assets/**` both through extension policy and independent hash checks.

The primary source baseline is archived Codex commit
`fe614a6304ef804be74a622e482fdd75977abcba`, especially
`codex-rs/core/src/session/turn.rs`: raw input and tool results remain in the
turn loop until real follow-up work settles. Claude evidence is limited to its
public tool dialect and observable behavior; this checkpoint makes no claim
about closed-source internals.

## Live Result

The fresh attempt is retained at:

`code/devseek-tests/n4-cpp-visual-math-user/runs/20260826T053922Z/`

DevSeek generated the C++ workspace under `workspace/`; the harness and this
iteration did not repair its source manually. Round 1 ran for 1120 seconds and
proved the repaired behavior:

- all required lowercase layered source files were generated;
- the acceptance files remained protected;
- compile failures were returned to the model and repaired;
- independent review found silent clamping of invalid script values, and the
  model refactored the model/controller return-value flow;
- the external `./test.sh` build and all self-tests exited 0.

The round still failed. Canonical completion ended with `tasksFailed=1` and
reason codes `unresolved-adverse-evidence`, `denied-effect`, and
`verification-failed`. Independent source hygiene also matched the word
`placeholder` in `src/raster_canvas.cpp`; the fixture's `.keep` files contain
the same word and must be considered when auditing the verifier. Rounds 2-4
were therefore not executed.

The fixture-only preparation check remains at
`/tmp/devseek-n4-prepare-check-20260826T132700`. It is not product evidence.

## Resume

Do not rerun this candidate as though the first round passed. First audit the
terminal adverse-evidence settlement and the source-hygiene ownership boundary,
fix the defect classes under the existing design principles, run the complete
regression and release loop, and create a new exact VSIX. Then start all four
rounds from a fresh generated workspace. Do not edit a generated C++ workspace
manually.

Human acceptance remains defined in `HUMAN-ACCEPTANCE.md` and starts only after
the automated four-round journey reports `ok: true`.
