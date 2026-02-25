// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Minimal, type-safe config persistence for CLI apps
// ────────────────────────────────────────────────────────────────────────────

// Errors
export type { StoreErrorCode } from "./errors.ts";
export { CrustStoreError } from "./errors.ts";
export type { PlatformEnv } from "./path.ts";
// Path
export { configDir } from "./path.ts";
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
	ValueType,
} from "./types.ts";
