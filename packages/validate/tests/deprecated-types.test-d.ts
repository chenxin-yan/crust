// Type-only test: the deprecated subpaths must continue to export legacy
// type aliases (ZodArgDef, ZodFlagDef, EffectArgDef, EffectFlagDef) with
// their pre-0.1.0 generic surface, so existing consumer code that imports
// them as types keeps compiling.

import * as schema from "effect/Schema";
import { z } from "zod";
import {
	type EffectArgDef,
	type EffectFlagDef,
	arg as effectArg,
	flag as effectFlag,
} from "../src/effect/index.ts";
import {
	type ZodArgDef,
	type ZodFlagDef,
	arg as zodArg,
	flag as zodFlag,
} from "../src/zod/index.ts";

// Zod 4 schemas natively implement Standard Schema, so `/zod` re-exports
// the root `arg`/`flag`. Their return types must satisfy the legacy aliases
// in both 3-generic and 4-generic forms.
const zArg = zodArg("port", z.number());
zArg satisfies ZodArgDef<"port", z.ZodNumber>;
zArg satisfies ZodArgDef<"port", z.ZodNumber, undefined, "number">;

const zFlag = zodFlag(z.boolean(), { short: "v" });
zFlag satisfies ZodFlagDef<z.ZodBoolean, "v">;
zFlag satisfies ZodFlagDef<z.ZodBoolean, "v", undefined, undefined, "boolean">;

// `/effect` accepts raw Effect schemas via its auto-wrap shim. Their return
// types must satisfy the legacy aliases parameterised with the raw schema
// (not with `StandardSchema`), preserving the pre-0.1.0 generic shape.
const eArg = effectArg("host", schema.String);
eArg satisfies EffectArgDef<"host", typeof schema.String>;
eArg satisfies EffectArgDef<"host", typeof schema.String, undefined, "string">;

const eFlag = effectFlag(schema.Number, { short: "p" });
eFlag satisfies EffectFlagDef<typeof schema.Number, "p">;
eFlag satisfies EffectFlagDef<
	typeof schema.Number,
	"p",
	undefined,
	undefined,
	"number"
>;
