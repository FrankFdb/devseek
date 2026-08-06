# DevSeek User Simulation Fixtures

Each subdirectory is a durable user-simulation scenario named after the capability
under test. The scenario owns its original inputs in `scenario.json`; immutable run
evidence belongs under `runs/<run-id>/`.

Run one iteration from the repository root:

```bash
npm run run:iteration-user-journeys -- --iteration I10 --run-id i10-local-20260806
```

The runner resolves cases from `docs/process/devseek-iteration-user-journeys.json`,
executes each source-bound test separately, retains raw TAP output, and writes a
machine-readable `result.json`. A later iteration must use a new scenario directory
or add genuinely new cases to the relevant scenario; fixed regression cases are not
recorded as iteration deltas.
