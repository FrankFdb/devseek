import {
  compileOperationalLanguageLexicon,
  loadOperationalLanguageLexiconConfigFromFile,
  type CompiledOperationalLanguageLexicon,
  type IntentRevisionPatternGroup,
  type OperationalLanguageLexiconConfig,
} from './operational-language-lexicon';

export type ExternalEffectIntent = 'none' | 'question' | 'requested';

let activeLexicon: CompiledOperationalLanguageLexicon = compileOperationalLanguageLexicon();

export function configureOperationalLanguageLexicon(config: OperationalLanguageLexiconConfig): void {
  activeLexicon = compileOperationalLanguageLexicon(config);
}

export function loadOperationalLanguageLexicon(filePath: string): void {
  configureOperationalLanguageLexicon(loadOperationalLanguageLexiconConfigFromFile(filePath));
}

export function resetOperationalLanguageLexicon(): void {
  activeLexicon = compileOperationalLanguageLexicon();
}

export function hasIntentRevisionLanguageSignal(
  group: IntentRevisionPatternGroup,
  text: string,
): boolean {
  return testAny(activeLexicon.intentRevision[group], text);
}

/** Splits user intent at top-level prose boundaries used by action classifiers. */
export function splitOperationalClauses(text: string): string[] {
  return String(text || '')
    .split(/[\r\n，,。；;！？!?]+/u)
    .map(clause => clause.trim())
    .filter(Boolean);
}

/**
 * Classifies host-visible release/deploy actions without treating domain APIs
 * named publish/release as external effects.
 */
export function classifyExternalEffectIntent(text: string): ExternalEffectIntent {
  let questionSeen = false;
  let requestSeen = false;
  for (const clause of splitOperationalClauses(text)) {
    const negated = testAny(activeLexicon.externalEffect.negated, clause);
    const positiveClause = stripExternalEffectProhibitionPhrases(clause);
    if (negated && positiveClause.trim().length === 0) {
      requestSeen = false;
      questionSeen = false;
      continue;
    }
    if (testAny(activeLexicon.externalEffect.domainInstallAction, positiveClause)) continue;
    const unambiguous = testAny(activeLexicon.externalEffect.unambiguous, positiveClause);
    const ambiguousRelease = testAny(activeLexicon.externalEffect.ambiguousRelease, positiveClause)
      && !testAny(activeLexicon.externalEffect.domainOperation, positiveClause)
      && (testAny(activeLexicon.externalEffect.releaseTarget, positiveClause)
        || testAny(activeLexicon.externalEffect.bareReleaseImperative, positiveClause));
    if (!unambiguous && !ambiguousRelease) continue;
    if (testAny(activeLexicon.externalEffect.question, positiveClause)) {
      questionSeen = true;
      continue;
    }
    requestSeen = true;
  }
  return requestSeen ? 'requested' : questionSeen ? 'question' : 'none';
}

export function hasExternalEffectProhibition(text: string): boolean {
  return splitOperationalClauses(text).some(clause => testAny(activeLexicon.externalEffect.negated, clause));
}

export function stripOperationalRunProhibitionPhrases(text: string): string {
  return replaceAny(activeLexicon.runProhibition.phrase, text, ' ');
}

function stripExternalEffectProhibitionPhrases(text: string): string {
  return replaceAny(activeLexicon.externalEffect.negatedPhrase, text, ' ');
}

/**
 * Detects a request not to run host commands. Behavioral requirements saying
 * that a handler/subscription does not execute are deliberately outside this
 * boundary.
 */
export function hasOperationalRunProhibition(text: string): boolean {
  return splitOperationalClauses(text).some(clause => {
    const strong = testAny(activeLexicon.runProhibition.strong, clause);
    const weak = testAny(activeLexicon.runProhibition.weak, clause);
    if (!strong && !weak) return false;
    if (testAny(activeLexicon.runProhibition.domainExecutionSubject, clause)
      && !testAny(activeLexicon.runProhibition.operationalExecutionTarget, clause)) {
      return false;
    }
    return strong
      || testAny(activeLexicon.runProhibition.operationalExecutionTarget, clause)
      || testAny(activeLexicon.runProhibition.directWeak, clause);
  });
}

function testAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function replaceAny(patterns: readonly RegExp[], text: string, replacement: string): string {
  return patterns.reduce((current, pattern) => {
    pattern.lastIndex = 0;
    return current.replace(pattern, replacement);
  }, String(text || ''));
}
