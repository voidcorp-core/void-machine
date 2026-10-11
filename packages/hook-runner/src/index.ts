export { CO_OWNED_FILES, isCoOwned, PROJECT_DOCTRINE_PATH } from './co-owned.js';
export { journalFingerprint, readMissionJournals, type JournalReadOptions } from './journal.js';
export { type ProjectRoots, resolveProjectRoots } from './project-roots.js';
export {
  cachedInvocationAlert,
  installedSkillNames,
  invocationAlert,
  type LivenessVerdict,
  livenessVerdict,
  refreshInvocationVerdict,
  replacementFor,
  type ResolutionVerdict,
  resolutionVerdict,
  withSuccessor,
} from './invocation.js';
export {
  classifyMaterialized,
  DERIVED_LOAD_BEARING,
  derivedIgnoreEntries,
  isOwnedDerived,
  INSTALLED_ENTRIES,
  LEGACY_RENAMES,
  RETIRED_DIR,
  RETIRED_ENTRIES,
  MACHINE_ENTRIES,
  MATERIALIZED_OWNERSHIP,
  migratedName,
  type Ownership,
  ownershipOf,
  VOID_DIR,
  VOID_INSTALLED_DIR,
  VOID_OWNERSHIP,
  VOID_MACHINE_DIR,
  VOID_PREVIOUS_MACHINE_DIR,
  gitignoreBlock,
  isMachineEntry,
  legacyVoidPath,
  patchGitignore,
  stripManagedBlock,
  pendingMigrations,
  previousMachinePath,
  voidDir,
  voidInstalledDir,
  voidInstalledPath,
  voidMachineDir,
  voidMachinePath,
  voidReadPath,
} from './void-layout.js';
export {
  MAX_EVENT_LOG_BYTES,
  writeSequencedEvent,
  writeSequencedEventOnce,
  type IdempotentSequencedWriteOptions,
  type SequencedWriteOptions,
  type SequencedWriteResult,
} from './sequenced-writer.js';
export {
  discoverProjectRoot,
  evaluateRule,
  MAX_HOOK_INPUT_BYTES,
  parseHookText,
  parseHookPayload,
  type EvaluateRuleOptions,
  type RuleName,
} from './enforcement/runner.js';
export {
  compareFreshness,
  type Freshness,
  type FreshnessVerdict,
} from './freshness/compare.js';
export {
  CACHE_TTL_MS,
  cacheFilePath,
  readFreshnessCache,
  writeFreshnessCache,
  type FreshnessCacheEntry,
} from './freshness/cache.js';
export {
  DEFAULT_REGISTRY,
  NPM_PACKAGE,
  fetchLatestVersion,
  resolveRegistry,
} from './freshness/registry.js';
export { freshnessNotice, freshnessRelay, resolveFreshness, type InstallSource } from './freshness/notice.js';
export { readNpmrc } from './freshness/npmrc.js';
// The rule roster, exported so the wiring tests can be derived from it rather
// than repeating the names. A rule the runner knows and no runtime invokes is a
// rule that never runs, and a hand-written list cannot catch that.
export { RULE_NAMES, governingSkill } from './enforcement/governing-skill.js';
export {
  type ManagedMarkers,
  type MarkerPair,
  parseProductIdentity,
  PRODUCT_COMMAND,
  PRODUCT_IDENTITY,
  type ProductIdentity,
  productSetting,
} from './identity.js';
export { parseCheckpoint } from './lifecycle/checkpoint-codec.js';
export { hasManagedBlock, replaceManagedBlock } from './managed-block.js';
