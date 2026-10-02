import { z } from "zod";

import { password } from "./password.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _passwordTypeInferenceTests() {
	// Schema overload — resolves to the schema's transformed Output.
	// Strict Equal so a regression to `any`/union cannot slip through.
	const pin = await password({
		message: "?",
		schema: z.coerce.number(),
	});
	type _PinIsNumber = Expect<Equal<typeof pin, number>>;

	// Function-validator overload — resolves to string. Throw-on-fail contract.
	const secret = await password({
		message: "?",
		validate: (v) => {
			if (v.length < 8) throw new Error("too short");
		},
	});
	type _SecretIsString = Expect<Equal<typeof secret, string>>;

	// No validate — resolves to string.
	const raw = await password({ message: "?" });
	type _RawIsString = Expect<Equal<typeof raw, string>>;

	const schemaInWrongSlot = z.string();
	// @ts-expect-error — Standard Schemas belong in `schema`, not `validate`
	void password({ validate: schemaInWrongSlot });
	// @ts-expect-error — schema and validate are exclusive
	void password({ schema: z.string(), validate: () => {} });
}
