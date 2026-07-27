# C0 Manifest Aggregator Wiring

> Generated from local machine sources. Do not hand edit.

- Wiring ID: `DEVSEEK-GATE0-C0-MANIFEST-AGGREGATOR-WIRING/v1`
- Wiring SHA-256: `8e2cdd0284781c32e75fb1a09ebe523666eadd881aba75a945b4d14ea9def31b`
- Capability ledger SHA-256: `08bb2cc53b13c32807373db73cb80cda97a745cc4941aa919bbac4e76f5c45d5`
- Aggregator owner: `C0-QUALIFICATION-AGGREGATOR` / `wired`
- Manifest owner: `C0-QUALIFICATION-EVIDENCE-MANIFEST` / `wired`
- Guard coverage: `8/8`
- Failure oracle coverage: `8/8`
- Bypasses: `0`
- Qualification effect: `NONE`
- Claims permitted: `false`
- Asserts Gate 0 pass: `false`

## Aggregation Guards

| Guard | Source | Status |
| --- | --- | --- |
| `independent-derived-manifest` | `scripts/lib/devseek-qualification-evidence-manifest.mjs` | covered |
| `denominator-and-slot-accounting` | `scripts/lib/devseek-qualification-evidence-manifest.mjs` | covered |
| `failure-and-veto-preservation` | `scripts/lib/devseek-qualification-evidence-manifest.mjs` | covered |
| `retention-lock-and-anchor` | `scripts/lib/devseek-qualification-evidence-manifest.mjs` | covered |
| `current-state-and-provenance-invalidates` | `scripts/lib/devseek-qualification-evidence-manifest.mjs` | covered |
| `exact-claim-and-dependency-binding` | `scripts/lib/devseek-qualification-evidence-manifest.mjs` | covered |
| `local-policy-cannot-claim` | `scripts/lib/devseek-qualification-evidence-manifest.mjs` | covered |
| `run-evidence-auxiliary-only` | `scripts/lib/devseek-qualification-evidence-manifest.mjs` | covered |

## Failure Oracles

| Oracle | Expected Evidence | Status |
| --- | --- | --- |
| `writer-forged-summary` | `MANIFEST_DERIVATION_MISMATCH` | covered |
| `denominator-conserved` | `denominator` | covered |
| `primary-failure-sticky` | `product-miss` | covered |
| `preflight-session-veto` | `veto` | covered |
| `current-state-provenance-drift` | `MANIFEST_EVENT_HEAD_INVALIDATED` | covered |
| `dependency-exactness` | `DEPENDENCY_MANIFEST_NOT_QUALIFICATION_ELIGIBLE` | covered |
| `retention-anchor-and-rebind` | `MANIFEST_ID_REBIND_FORBIDDEN` | covered |
| `run-evidence-correlation-not-verdict` | `RUN_EVIDENCE_OUTCOME_BINDING_MISMATCH` | covered |

This wiring proves only local manifest aggregation reachability and bypass coverage. The local policy is not protected qualification authority; it cannot create claims, promote Gate 0, or replace external attestation and WORM retention.
