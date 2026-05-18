// Type-only test: repeatable validated flags are assignable to core's `FlagDef`
// when callers explicitly provide the parser metadata that exists at runtime.

import { Crust } from "@crustjs/core";
import * as schema from "effect/Schema";
import { z } from "zod";
import { flag } from "../src/index.ts";

// 1) Zod array of strings → repeatable string flag.
new Crust("x").flags({
	tags: flag(z.array(z.string()), { type: "string", multiple: true }),
});

// 2) Zod array of numbers → repeatable number flag.
new Crust("x").flags({
	ports: flag(z.array(z.number()), { type: "number", multiple: true }),
});

// 3) Effect Array(String) wrapped → repeatable string flag.
new Crust("x").flags({
	hosts: flag(schema.standardSchemaV1(schema.Array(schema.String)), {
		type: "string",
		multiple: true,
	}),
});

// 4) Scalar boolean → single-value flag (regression: should still work).
new Crust("x").flags({
	verbose: flag(z.boolean().default(false), { type: "boolean", short: "v" }),
});
