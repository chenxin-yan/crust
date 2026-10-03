import { z } from "zod";

import { input } from "./input.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _inputTypeInferenceTests() {
	// Schema overload — resolves to the schema's transformed Output.
	// Strict Equal so a regression to `any`/union cannot slip through.
	const port = await input({
		message: "?",
		schema: z.coerce.number(),
	});
	type _PortIsNumber = Expect<Equal<typeof port, number>>;

	// Function-validator overload — resolves to string. Throw-on-fail contract.
	const name = await input({
		message: "?",
		validate: (v) => {
			if (v.length === 0) throw new Error("required");
		},
	});
	type _NameIsString = Expect<Equal<typeof name, string>>;

	// No validate — resolves to string.
	const raw = await input({ message: "?" });
	type _RawIsString = Expect<Equal<typeof raw, string>>;

	const schemaInWrongSlot = z.string();
	// @ts-expect-error — Standard Schemas belong in `schema`, not `validate`
	void input({ validate: schemaInWrongSlot });
	// @ts-expect-error — schema and validate are exclusive
	void input({ schema: z.string(), validate: () => {} });
}
