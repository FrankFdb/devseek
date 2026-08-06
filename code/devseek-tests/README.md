# DevSeek Local User Simulation Evidence

This tree contains local, untracked user-simulation inputs and raw run evidence.
Generated `scenario.json`, TAP output, and `runs/<run-id>/` receipts stay available
for later replay but must not be committed.

Versioned, deterministic scenario fixtures live under
`scripts/test/fixtures/user-simulations/`. The iteration manifest maps each fixture
to a local artifact root so the runner never writes generated evidence into a
tracked test-source directory.

Run one iteration from the repository root:

```bash
npm run run:iteration-user-journeys -- --iteration I10 --run-id i10-local-20260806
```

The runner resolves cases from `docs/process/devseek-iteration-user-journeys.json`,
executes each source-bound test separately, retains raw TAP output here, and writes
a machine-readable `result.json`. A later iteration must add genuinely new cases;
fixed regression cases are not recorded as iteration deltas.
