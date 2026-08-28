/** Shared interpretation rules for model-authored reviews of validation evidence. */
export const VALIDATION_EVIDENCE_REVIEW_RULES = Object.freeze([
  'Validation expected values describe observable acceptance conditions; they are not literal artifact schemas unless the original requirement or an explicitly delegated contract declares the same schema.',
  'Treat matcher notation such as minimum, maximum, pattern, anyOf, and contains as predicates on the parent value, never as properties to add to production output.',
  'When matcher metadata appears to conflict with an explicit artifact type or shape, preserve the declared artifact contract and apply the matcher as a predicate. Do not invent a schema migration from test-report formatting.',
]);
