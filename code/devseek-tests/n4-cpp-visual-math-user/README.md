# N4 C++ Visual Math Simulated User Journey

This journey exercises DevSeek as a coding agent through four natural user
follow-ups over one persistent workspace. It requires real C++ implementation,
compilation, tests, deterministic graphical output, shared UI/script behavior,
and a real X11 window smoke run.

The product harness submits every prompt through the visible VS Code Webview,
uses the real Provider, waits for the detached memory pipeline to become idle,
and restarts VS Code between rounds. Each round retains the exact product report,
run log, build output, state JSON, and PPM pixel evidence under the ignored
`runs/` tree.

Run the complete journey against the latest packaged candidate:

```bash
node code/devseek-tests/n4-cpp-visual-math-user/run-journey.mjs --run --relogin
```

Useful options:

```bash
--vsix /absolute/path/to/candidate.vsix
--rounds 1,2,3,4
--timeout-ms 900000
--command-input
```

Reuse a retained implementation without regenerating Round 1 code. The runner
first requires the previous stage to pass the independent workspace verifier;
only then does it submit the selected consecutive follow-ups:

```bash
node code/devseek-tests/n4-cpp-visual-math-user/run-journey.mjs --run \
  --workspace /absolute/path/to/retained/workspace \
  --rounds 2,3,4 \
  --vsix /absolute/path/to/candidate.vsix
```

Resume an interrupted current round with validation first. If the current stage
already passes, the runner skips that round and starts the next follow-up. If it
fails, the failure is retained as preflight evidence and DevSeek repairs the
same workspace before the stage is verified again:

```bash
node code/devseek-tests/n4-cpp-visual-math-user/run-journey.mjs --run \
  --workspace /absolute/path/to/retained/workspace \
  --rounds 2,3,4 \
  --repair-current \
  --vsix /absolute/path/to/candidate.vsix
```

Run validation only, with no Provider request or source generation:

```bash
node code/devseek-tests/n4-cpp-visual-math-user/verify-workspace.mjs \
  /absolute/path/to/retained/workspace 1 /absolute/path/to/evidence
```

An existing-workspace continuation is diagnostic iteration evidence. A formal
four-round candidate result still starts from a fresh workspace.

`--command-input` is diagnostic only. Formal local N4 evidence uses the default
`natural-ui` route and must report `commandInjected=false`.

This is local implementation evidence, not an independent protected-profile
signature and not Gate 0 qualification evidence.
