// Type-only regression test for `AllFlagsHaveSchema<{}>`.
//
// Previously, when a command was built with `.flags({})` (zero user-defined
// flags), `keyof F` collapsed to `never` and the distributive lookup
// `{[K in keyof F]: ...}[keyof F]` evaluated to `never` — propagating through
// `HasAllSchemas` and resolving `CommandValidatorHandler<A, {}>` to `never`.
//
// This file forces the compiler to instantiate `commandValidator` against a
// command that has args carrying a Standard Schema and an empty flags map.
// If the regression returns, this file fails to type-check with
// "not assignable to parameter of type 'never'".

import { Crust } from "@crustjs/core";
import { z } from "zod";
import { arg, commandValidator } from "../src/index.ts";

const cmd = new Crust("noop")
	.args([arg("port", z.number().int().min(1))])
	.flags({})
	.run(
		commandValidator(({ args, flags }) => {
			// `args.port` must narrow to `number`, and `flags` must be the
			// empty record produced for `flags: {}`.
			const _port: number = args.port;
			const _flags: Record<string, never> = flags;
			void _port;
			void _flags;
		}),
	);

void cmd;
