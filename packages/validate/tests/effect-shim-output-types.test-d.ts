// Type-only test: the deprecated `@crustjs/validate/effect` subpath shim
// must preserve the raw Effect schema's *output* type (the parsed `A`) when
// fed back through `InferValidatedArgs` / `InferValidatedFlags`. Otherwise
// existing Effect builders see `unknown` in their handlers.
//
// Verifies should-fix #13.

import { Crust } from "@crustjs/core";
import * as schema from "effect/Schema";
import {
	arg as earg,
	commandValidator as ecommandValidator,
	flag as eflag,
	type InferValidatedArgs,
	type InferValidatedFlags,
} from "../src/effect/index.ts";

// Type-level: extract the inferred handler args/flags shape.
const argsTuple = [
	earg("name", schema.String),
	earg("port", schema.Number),
] as const;

type Args = InferValidatedArgs<typeof argsTuple>;
const _argsName: Args["name"] = "alice";
const _argsPort: Args["port"] = 80;
void _argsName;
void _argsPort;

const flagsRecord = {
	verbose: eflag(schema.Boolean),
	mode: eflag(schema.String),
} as const;

type Flags = InferValidatedFlags<typeof flagsRecord>;
const _flagsVerbose: Flags["verbose"] = true;
const _flagsMode: Flags["mode"] = "dev";
void _flagsVerbose;
void _flagsMode;

// End-to-end: handler should receive narrow types from raw Effect schemas.
new Crust("serve")
	.args([earg("host", schema.String), earg("port", schema.Number)])
	.flags({ verbose: eflag(schema.Boolean) })
	.run(
		ecommandValidator(({ args, flags }) => {
			const _host: string = args.host;
			const _port: number = args.port;
			const _verbose: boolean = flags.verbose;
			void _host;
			void _port;
			void _verbose;
		}),
	);
