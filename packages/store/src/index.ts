// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store
// ────────────────────────────────────────────────────────────────────────────

// Errors
export type { StoreErrorCode, ValidationErrorDetails } from "./errors.ts";
export { CrustStoreError } from "./errors.ts";
// Lock
export type { LockOptions } from "./lock.ts";
export { withLock } from "./lock.ts";
// Path
export type { PlatformEnv } from "./path.ts";
export { cacheDir, configDir, dataDir, stateDir } from "./path.ts";
// Persistence
export type { FileLockOptions } from "./persistence.ts";
export { withFileLock } from "./persistence.ts";
// Store
export { createStore } from "./store.ts";
// Types
export type {
	CreateStoreOptions,
	FieldDef,
	FieldsDef,
	InferStoreConfig,
	Store,
	StoreAccess,
	StoreMutationOptions,
	StorePermissionBits,
	StoreUpdater,
	StoreValidatorIssue,
	ValueType,
} from "./types.ts";
