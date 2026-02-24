// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Minimal, type-safe config persistence for CLI apps
// ────────────────────────────────────────────────────────────────────────────

// Errors
export type { StoreErrorCode } from "./errors.ts";
export { CrustStoreError } from "./errors.ts";
// Types
export type {
	CreateStore,
	CreateStoreBaseOptions,
	CreateStoreOptions,
	CreateStoreOptionsWithDefaults,
	CreateStoreOptionsWithValidator,
	Store,
	StoreConfigShape,
	StoreUpdater,
	StoreValidator,
} from "./types.ts";
