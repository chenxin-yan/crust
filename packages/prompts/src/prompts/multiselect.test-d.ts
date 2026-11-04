import { multiselect } from "./multiselect.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _multiselectTypeInferenceTests() {
	const tags = await multiselect({ message: "?", choices: ["a", "b"] });
	type _TagsNarrow = Expect<Equal<typeof tags, ("a" | "b")[]>>;

	const widened: string[] = ["a", "b"];
	const loose = await multiselect({ message: "?", choices: widened });
	type _LooseIsStrings = Expect<Equal<typeof loose, string[]>>;
	const explicitUnion = await multiselect<"dev" | "prod">({
		choices: [{ label: "Development", value: "dev" }, "prod"],
	});
	type _ExplicitUnionIsPreserved = Expect<Equal<typeof explicitUnion, ("dev" | "prod")[]>>;

	const viaGenericChoices = <C extends readonly string[]>(choices: C) => multiselect({ choices });
	type _GenericChoicesReturnStrings = Expect<
		Equal<ReturnType<typeof viaGenericChoices>, Promise<string[]>>
	>;
	const viaGenericObjects = <C extends readonly { label: string; value: number }[]>(choices: C) =>
		multiselect({ choices });
	type _GenericObjectsReturnNumbers = Expect<
		Equal<ReturnType<typeof viaGenericObjects>, Promise<number[]>>
	>;

	// @ts-expect-error "c" is not one of the literal choices
	void multiselect({ message: "?", choices: ["a", "b"], default: ["c"] });
	const looseDefault = await multiselect({ message: "?", choices: widened, default: ["c"] });
	type _LooseDefaultIsStrings = Expect<Equal<typeof looseDefault, string[]>>;
}
