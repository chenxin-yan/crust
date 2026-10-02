import { createPrompts } from "../create-prompts.ts";
import { select, type SelectOptions } from "./select.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _selectTypeInferenceTests() {
	// Literal string choices narrow to the literal union via `const T`.
	const env = await select({ message: "?", choices: ["dev", "staging", "prod"] });
	type _EnvNarrows = Expect<Equal<typeof env, "dev" | "staging" | "prod">>;

	// Object choices narrow on their literal `value`s.
	const port = await select({
		message: "?",
		choices: [
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443 },
		],
	});
	type _PortNarrows = Expect<Equal<typeof port, 80 | 443>>;

	// A widened string[] variable keeps plain string.
	const widened: string[] = ["a", "b"];
	const loose = await select({ message: "?", choices: widened });
	type _LooseIsString = Expect<Equal<typeof loose, string>>;

	// An explicit type argument still resolves to the generic overload.
	const explicit = await select<number>({
		message: "?",
		choices: [{ label: "HTTP", value: 80 }],
	});
	type _ExplicitWins = Expect<Equal<typeof explicit, number>>;

	// An explicit non-string type argument rejects plain-string choices, which
	// would otherwise submit a string where the caller was promised a number.
	void select<number>({
		message: "?",
		// @ts-expect-error "oops" is not a `number` choice value
		choices: ["oops"],
	});
	void select<"dev" | "prod">({
		message: "?",
		// @ts-expect-error "staging" is outside the literal union
		choices: ["dev", "staging"],
	});

	// Mixed plain-string and object choices still infer the value union.
	const mixed = await select({
		message: "?",
		choices: ["none", { label: "HTTP", value: 80 }],
	});
	type _MixedNarrows = Expect<Equal<typeof mixed, "none" | 80>>;

	// A generic wrapper over SelectOptions<T> still resolves to Promise<T>.
	const viaWrapper = (options: SelectOptions<number>): Promise<number> => select(options);
	void viaWrapper;

	// createPrompts instances pass narrowing through (`typeof select`).
	const p = createPrompts();
	const themed = await p.select({ message: "?", choices: ["a", "b"] });
	type _ThemedNarrows = Expect<Equal<typeof themed, "a" | "b">>;
}
