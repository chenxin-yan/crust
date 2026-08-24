// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Typed persistence for CLI apps
// ────────────────────────────────────────────────────────────────────────────

// Errors
export type { StoreErrorCode, ValidationErrorDetails } from "./errors.ts";
export { CrustStoreError } from "./errors.ts";
// Path
export { cacheDir, configDir, dataDir, stateDir } from "./path.ts";
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
	StorePermissionBits,
	StoreUpdater,
	StoreValidatorIssue,
	ValueType,
} from "./types.ts";
