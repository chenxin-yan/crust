import { multiselect } from "./multiselect.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _multiselectTypeInferenceTests() {
	const tags = await multiselect({ message: "?", choices: ["a", "b"] });
	type _TagsNarrow = Expect<Equal<typeof tags, ("a" | "b")[]>>;

	const widened: string[] = ["a", "b"];
	const loose = await multiselect({ message: "?", choices: widened });
	type _LooseIsStrings = Expect<Equal<typeof loose, string[]>>;

	// @ts-expect-error "c" is not one of the literal choices
	void multiselect({ message: "?", choices: ["a", "b"], default: ["c"] });
	const looseDefault = await multiselect({ message: "?", choices: widened, default: ["c"] });
	type _LooseDefaultIsStrings = Expect<Equal<typeof looseDefault, string[]>>;
}
