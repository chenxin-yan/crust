import { multifilter } from "./multifilter.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _multifilterTypeInferenceTests() {
	const picks = await multifilter({ message: "?", choices: ["a", "b"] });
	type _PicksNarrow = Expect<Equal<typeof picks, ("a" | "b")[]>>;

	const widened: string[] = ["a", "b"];
	const loose = await multifilter({ message: "?", choices: widened });
	type _LooseIsStrings = Expect<Equal<typeof loose, string[]>>;

	// @ts-expect-error "c" is not one of the literal choices
	void multifilter({ message: "?", choices: ["a", "b"], default: ["c"] });
	const looseDefault = await multifilter({ message: "?", choices: widened, default: ["c"] });
	type _LooseDefaultIsStrings = Expect<Equal<typeof looseDefault, string[]>>;
}
