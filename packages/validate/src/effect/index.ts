// ────────────────────────────────────────────────────────────────────────────
// @crustjs/validate/effect — Effect schema-first mode for Crust CLI
// ────────────────────────────────────────────────────────────────────────────

// Schema-first command factory
export { defineEffectCommand } from "./command.ts";

// Schema-first DSL helpers
export { arg, flag } from "./schema.ts";

// Public types
export type {
	ArgOptions,
	ArgSpec,
	ArgSpecs,
	EffectCommandDef,
	EffectCommandRunHandler,
	EffectSchemaLike,
	FlagOptions,
	FlagShape,
	FlagSpec,
	InferArgsFromConfig,
	InferArgsFromSpecs,
	InferFlagsFromConfig,
	InferFlagsFromShape,
	InferSchemaOutput,
} from "./types.ts";
