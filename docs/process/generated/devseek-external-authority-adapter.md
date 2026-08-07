# External Authority Adapter Contract

> Generated from local machine sources. Do not hand edit.

- Adapter ID: `DEVSEEK-GATE0-EXTERNAL-AUTHORITY-ADAPTER/v1`
- Adapter SHA-256: `c59b8d17b0332ec3e0e52cb7b915a3c2a2a022ed1581296633f233cb5f707a4d`
- Source status: `unconfigured`
- Trust roots: `0`
- Source guard coverage: `8/8`
- Failure oracle coverage: `7/7`
- Bypasses: `0`
- Current authority status: `UNAVAILABLE_NO_EXTERNAL_TRUST_ROOT`
- Claims permitted: `false`
- Asserts Gate 0 pass: `false`

## Required Controls

- `source-digest-binding`
- `independent-authority-attestation`
- `organizational-role-separation`
- `revocation-aware-trust-root`
- `trusted-nonrollback-time`
- `retention-lock-or-worm`
- `manifest-provenance-binding`

## Source Guards

| Guard | Source | Status |
| --- | --- | --- |
| `gate0-consumes-adapter-result` | `scripts/lib/devseek-gate0-decision.mjs` | covered |
| `ordinary-object-and-boolean-rejected` | `scripts/lib/devseek-external-authority-adapter.mjs` | covered |
| `no-local-trust-root-fallback` | `scripts/lib/devseek-external-authority-adapter.mjs` | covered |
| `revocation-and-role-reuse-rejected` | `scripts/lib/devseek-external-authority-adapter.mjs` | covered |
| `clock-rollback-rejected` | `scripts/lib/devseek-external-authority-adapter.mjs` | covered |
| `manifest-provenance-mismatch-rejected` | `scripts/lib/devseek-external-authority-adapter.mjs` | covered |
| `detached-signature-verified-before-trust` | `scripts/lib/devseek-external-authority-adapter.mjs` | covered |
| `gate0-schema-remains-nonqualifying` | `docs/process/devseek-gate0-decision.schema.json` | covered |

## Failure Oracles

| Oracle | Expected Status | Status |
| --- | --- | --- |
| `boolean-pass-rejected` | `REJECTED_ATTESTATION_NOT_OBJECT` | covered |
| `ordinary-object-rejected` | `REJECTED_ATTESTATION_SCHEMA_VERSION` | covered |
| `revoked-root-rejected` | `REJECTED_TRUST_ROOT_REVOKED` | covered |
| `role-reuse-rejected` | `REJECTED_ROLE_REUSE` | covered |
| `clock-rollback-rejected` | `REJECTED_CLOCK_ROLLBACK` | covered |
| `manifest-provenance-mismatch-rejected` | `REJECTED_MANIFEST_OR_PROVENANCE_MISMATCH` | covered |
| `valid-local-crypto-still-not-audited` | `REJECTED_TRUST_ROOT_NOT_AUDITED` | covered |

This adapter is an import contract only. The repository ships no trusted external root, creates no qualification claim, and cannot turn local evidence into Gate 0 PASS.
