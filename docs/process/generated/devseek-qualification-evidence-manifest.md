# G0-C Qualification Evidence Manifest machine view

> Generated from `docs/process/devseek-qualification-aggregator-policy.json`. Do not hand edit.

- Schema: `devseek.qualification-evidence-manifest/v1`
- Policy: `DEVSEEK-G0C-LOCAL-AGGREGATOR-POLICY`
- Policy SHA-256: `08897f5f2c6994fd2ae4d130648c38ab2eb6971b840a02b3b212430fcd45fb9e`
- Policy source: `test-fixture`
- Integrity scope: `local-protocol-conformance`
- Qualification eligible: `false`
- Repository claim rules: `0`
- Maximum manifest TTL: `7200s`
- Retention class: `append-only-local-cas`
- Independent expected anchor required: `true`

| Purpose | Key | Identity | Status |
| --- | --- | --- | --- |
| qualification-manifest | `devseek-g0c-test-manifest-aggregator-01` | `local-fixture/devseek-g0c-independent-aggregator` | test-only |
| retention-lock | `devseek-g0c-test-retention-lock-01` | `local-fixture/devseek-g0c-independent-retention` | test-only |

This repository policy is a test fixture for deterministic local protocol conformance only. It does not contain protected qualification keys, external WORM storage, a live frozen candidate, or any qualification claim. Fixture tests may derive exact-tuple `claim_candidates` to test the aggregator, but `qualification_claims` and the verifier's eligible claim result remain empty whenever `qualification_eligible=false`.

The reader independently replays signed plan/profile/catalog/key-registry/event/receipt inputs, enumerates every preregistered slot and attempt, applies a fail-closed preflight/session semantic state machine, recomputes denominator/failure/veto/candidate fields, verifies purpose-separated signatures and time bounds, and compares the supplied current candidate/dependency/provider/surface/platform/event heads and expiry. `currentState` is recomputed by the caller from the supplied frozen evidence; it is not an independently observed live deployment state. Recursive dependencies are checked at the top-level reader's current time while historical `generated_at` is used only to recompute signed derived fields. Product Run Evidence is accepted only as a sealed snapshot plus an independently retained expected anchor and always remains auxiliary, `product-run-diagnostics`, and `qualification_eligible=false`.

The local append-only CAS store is not WORM and cannot support protected qualification. It requires an explicit caller-retained expected anchor for every retain and audit. Its only genesis anchor is `{record_count:0, final_record_sha256:null, final_lock_sha256:null}`, accepted only for a pristine, constructor-pinned directory tree. On POSIX, the root and all four store directories must be owned by the current user and must not be writable by group or other; non-POSIX or unavailable nofollow/procfd capability support fails closed. Construction pins five directory descriptors and verifies each `/proc/self/fd/<dirfd>` capability against its inode. Every enumeration, read, atomic create, hard-link publish, and genesis-pristine check is relative to those capabilities, so even transient namespace replacement/restoration cannot present an empty tree. `close()` and `dispose()` are idempotent, close all five descriptors, and permanently close the store instance.

The checker executes at least 35 assertions and binds 13 required adversarial scenario names, preventing an equal-count dummy suite from replacing the audited attacks.
