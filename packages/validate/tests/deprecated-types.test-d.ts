// Type-only test: deprecated subpaths must continue to export legacy type
// aliases (ZodArgDef, ZodFlagDef, EffectArgDef, EffectFlagDef) so existing
// consumer code that imports them as types keeps compiling.
//
// Verifies blocker #2 fix.

import * as schema from "effect/Schema";
import { z } from "zod";
import type { EffectArgDef, EffectFlagDef } from "../src/effect/index.ts";
import { arg as argRoot, flag as flagRoot } from "../src/index.ts";
import type { ZodArgDef, ZodFlagDef } from "../src/zod/index.ts";

// 1) Zod aliases — accept the same generic shape origin/main accepted.
const zodArgValue = argRoot("name", z.string());
const _zodArgAssign: ZodArgDef<"name", z.ZodString> = zodArgValue as never;
void _zodArgAssign;

const zodFlagValue = flagRoot(z.boolean(), { short: "v" });
const _zodFlagAssign: ZodFlagDef = zodFlagValue as never;
void _zodFlagAssign;

// 2) Effect aliases — accept the same generic shape origin/main accepted.
const effectSchema = schema.standardSchemaV1(schema.String);
const effectArgValue = argRoot("host", effectSchema);
const _effectArgAssign: EffectArgDef = effectArgValue as never;
void _effectArgAssign;

const effectFlagValue = flagRoot(effectSchema);
const _effectFlagAssign: EffectFlagDef = effectFlagValue as never;
void _effectFlagAssign;
