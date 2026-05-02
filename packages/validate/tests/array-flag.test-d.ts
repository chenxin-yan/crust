// Type-only test: `flag(z.array(...))` and other array Standard Schemas must
// be assignable to core's `FlagDef` (which discriminates on `multiple: true`).
//
// Verifies should-fix #12.

import { Crust } from "@crustjs/core";
import * as schema from "effect/Schema";
import { z } from "zod";
import { flag } from "../src/index.ts";

// 1) Zod array of strings → repeatable string flag.
new Crust("x").flags({
	tags: flag(z.array(z.string())),
});

// 2) Zod array of numbers → repeatable number flag.
new Crust("x").flags({
	ports: flag(z.array(z.number())),
});

// 3) Effect Array(String) wrapped → repeatable string flag.
new Crust("x").flags({
	hosts: flag(schema.standardSchemaV1(schema.Array(schema.String))),
});

// 4) Scalar boolean → single-value flag (regression: should still work).
new Crust("x").flags({
	verbose: flag(z.boolean().default(false), { short: "v" }),
});
