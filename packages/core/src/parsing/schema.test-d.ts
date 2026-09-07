import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust } from "../command/crust.ts";

type StandardInput = Parameters<StandardSchema["~standard"]["validate"]>[0];

/** Minimal hand-rolled Standard Schema (no vendor dependency). */
function schema<Input, Output>(
	validate: (value: Input) => { value: Output } | { issues: { message: string }[] },
): StandardSchema<Input, Output> {
	return {
		"~standard": {
			version: 1,
			vendor: "crust-test",
			validate: (value: StandardInput) => validate(value as Input),
		},
	};
}

const port = () =>
	schema<string | undefined, number>((raw) => {
		if (raw === undefined) return { issues: [{ message: "port is required" }] };
		const value = Number(raw);
		return Number.isInteger(value) && value > 0
			? { value }
			: { issues: [{ message: "expected a positive integer" }] };
	});

// Compile-time regression checks; intentionally never invoked.
// the schema output type reaches the Command Action
function _typecheckTheSchemaOutputTypeReachesTheCommandAction() {
	new Crust("cli")
		.args({ name: "port", schema: port() })
		.flags({ name: "tag", type: "string", schema: port() })
		.action((_ctx) => {
			type _argOutput = Expect<Equal<(typeof _ctx.args)["port"], number>>;
			type _flagOutput = Expect<Equal<(typeof _ctx.flags)["tag"], number>>;
		});
}
