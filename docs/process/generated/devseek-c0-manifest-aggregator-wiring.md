# C0 Manifest Aggregator Wiring

> Generated from local machine sources. Do not hand edit.

- Wiring ID: `DEVSEEK-GATE0-C0-MANIFEST-AGGREGATOR-WIRING/v1`
- Wiring SHA-256: `c16b5a0de347b7b0edacbad6c4ad9a5ebe5dfb50635f3f9580241326a5a1b6ba`
- Capability ledger SHA-256: `4e2faf1b579c049dd0cb8f51d393fcf2bda12b3ca695593c739efb3aded5286f`
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
