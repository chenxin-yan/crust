// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Typed persistence for CLI apps
// ────────────────────────────────────────────────────────────────────────────

// Errors
export type {
	DefinitionErrorDetails,
	StoreErrorCode,
	ValidationErrorDetails,
} from "./errors.ts";
export { CrustStoreError } from "./errors.ts";
// Schema-driven field factory
export { type FieldOptions, field } from "./field.ts";
export type { PlatformEnv } from "./path.ts";
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
	StoreUpdater,
	StoreValidatorIssue,
	ValueType,
} from "./types.ts";
