import type { StandardSchema } from "@crustjs/utils/schema";

import { Crust } from "../command/crust.ts";

declare const schema: StandardSchema<string, number>;
new Crust("cli")
	.args({ name: "__proto__", type: "string", required: true })
	.flags({
		constructor: { type: "string", required: true },
		toString: { type: "string", required: true },
		hasOwnProperty: { type: "string", required: true },
		schema: { type: "string", schema },
	})
	.action(({ args, flags }) => {
		const values: string[] = [
			args.__proto__,
			flags.constructor,
			flags.toString,
			flags.hasOwnProperty,
		];
		const output: number = flags.schema;
		void [values, output];
	});
