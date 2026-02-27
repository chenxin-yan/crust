// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Typed persistence for CLI apps
// ────────────────────────────────────────────────────────────────────────────

// Errors
export type {
	StoreErrorCode,
	StoreValidationIssue,
	ValidationErrorDetails,
} from "./errors.ts";
export { CrustStoreError } from "./errors.ts";
export type { PlatformEnv } from "./path.ts";
// Path
export { cacheDir, configDir, dataDir, stateDir } from "./path.ts";
// Store
export { createStore } from "./store.ts";
// Types
export type {
	CreateStoreOptions,
	Store,
	StoreUpdater,
	StoreValidator,
	StoreValidatorFailure,
	StoreValidatorIssue,
	StoreValidatorResult,
	StoreValidatorSuccess,
} from "./types.ts";
